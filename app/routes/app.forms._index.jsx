import { useLoaderData, Link, useRouteError, useSubmit, useActionData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { EmptyState } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }) => {
  try {
    const { session } = await authenticate.admin(request);
    const forms = await db.form.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
    });

    let recentSubmissions = [];
    try {
      recentSubmissions = await db.formSubmission.findMany({
        where: {
          form: {
            shop: session.shop
          }
        },
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          form: {
            select: { title: true }
          }
        }
      });
    } catch (dbError) {
      console.error("Failed to fetch recent submissions:", dbError);
      // We don't want to crash the whole page if just the submissions fail
    }

    return { forms, recentSubmissions };
  } catch (error) {
    console.error("Dashboard Loader Error:", error);
    throw error; // Let the ErrorBoundary handle the main crash
  }
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const formId = formData.get("id");
  const intent = formData.get("intent");
  const submissionId = formData.get("submissionId");

  if (intent === "delete" && formId) {
    const pId = parseInt(formId);
    // Delete related submissions first to avoid FK violation
    await db.formSubmission.deleteMany({
      where: { formId: pId },
    });
    
    await db.form.deleteMany({
      where: {
        id: pId,
        shop: session.shop,
      },
    });
    return { status: "success" };
  }

  if (intent === "reject") {
    if (!submissionId) return { status: "error", message: "Submission ID required" };

    const submission = await db.formSubmission.findUnique({
      where: { id: parseInt(submissionId) }
    });
    const data = JSON.parse(submission.data);

    // Find email
    const keys = Object.keys(data);
    const emailKey = keys.find(k => k.toLowerCase().includes("email"));
    const firstNameKey = keys.find(k => k.toLowerCase().includes("first"));
    const lastNameKey = keys.find(k => k.toLowerCase().includes("last"));
    const nameKey = keys.find(k => k.toLowerCase() === "name" || k.toLowerCase().includes("name"));
    const phoneKey = keys.find(k => k.toLowerCase().includes("phone") || k.toLowerCase().includes("mobile"));

    const email = emailKey ? data[emailKey] : null;
    const firstName = firstNameKey ? data[firstNameKey] : (nameKey ? data[nameKey] : "");
    const lastName = lastNameKey ? data[lastNameKey] : "";
    const phone = phoneKey ? data[phoneKey] : null;

    if (!email) {
      return { status: "error", message: "Could not find an email address in the submission data." };
    }

    try {
      // Check if customer exists
      const customerQuery = await admin.graphql(
        `#graphql
         query getCustomer($query: String!) {
           customers(first: 1, query: $query) {
             edges {
               node {
                 id
                 tags
                 firstName
                 lastName
                 phone
               }
             }
           }
         }`,
        { variables: { query: `email:${email}` } }
      );
      const customerJson = await customerQuery.json();
      const existingCustomer = customerJson.data?.customers?.edges?.[0]?.node;

      if (existingCustomer) {
        // Customer exists - remove B2B_approved if present and add B2B_rejected
        let currentTags = existingCustomer.tags || [];
        currentTags = currentTags.filter(tag => tag !== "B2B_approved");
        if (!currentTags.includes("B2B_rejected")) {
          currentTags.push("B2B_rejected");
        }

        // Prepare customer input with updated details if different
        const customerInput = {
          id: existingCustomer.id,
          tags: currentTags
        };

        // Update firstName if different
        if (firstName && firstName !== existingCustomer.firstName) {
          customerInput.firstName = firstName;
        }

        // Update lastName if different
        if (lastName && lastName !== existingCustomer.lastName) {
          customerInput.lastName = lastName;
        }

        // Update phone if different
        if (phone && phone !== existingCustomer.phone) {
          customerInput.phone = phone;
        }

        const updateResponse = await admin.graphql(
          `#graphql
          mutation updateCustomer($input: CustomerInput!) {
            customerUpdate(input: $input) {
              userErrors {
                field
                message
              }
            }
          }`,
          { variables: { input: customerInput } }
        );
        const updateJson = await updateResponse.json();
        if (updateJson.data?.customerUpdate?.userErrors?.length > 0) {
          return { status: "error", message: "Failed to update tags: " + updateJson.data.customerUpdate.userErrors[0].message };
        }
      } else {
        // Customer doesn't exist - create with B2B_rejected tag
        const createResponse = await admin.graphql(
          `#graphql
          mutation customerCreate($input: CustomerInput!) {
            customerCreate(input: $input) {
              customer {
                id
                email
              }
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: {
              input: {
                email: email,
                firstName: firstName,
                lastName: lastName,
                phone: phone,
                tags: ["B2B_rejected"]
              }
            }
          }
        );
        const createJson = await createResponse.json();
        if (createJson.data?.customerCreate?.userErrors?.length > 0) {
          return { status: "error", message: "Failed to create customer: " + createJson.data.customerCreate.userErrors[0].message };
        }
      }
    } catch (error) {
      console.error("Customer Access Error (Reject):", error);
      return {
        status: "error",
        message: `Error: ${error.message || JSON.stringify(error)}`
      };
    }

    await db.formSubmission.update({
      where: { id: parseInt(submissionId) },
      data: { status: "REJECTED" }
    });

    return { status: "success", message: "Submission rejected" };
  }

  if (intent === "approve") {
    const submission = await db.formSubmission.findUnique({
      where: { id: parseInt(submissionId) }
    });
    const data = JSON.parse(submission.data);

    // Find email and name case-insensitively
    const keys = Object.keys(data);
    const emailKey = keys.find(k => k.toLowerCase().includes("email"));
    const firstNameKey = keys.find(k => k.toLowerCase().includes("first"));
    const lastNameKey = keys.find(k => k.toLowerCase().includes("last"));
    const nameKey = keys.find(k => k.toLowerCase() === "name" || k.toLowerCase().includes("name"));

    const email = emailKey ? data[emailKey] : null;
    const firstName = firstNameKey ? data[firstNameKey] : (nameKey ? data[nameKey] : "");
    const lastName = lastNameKey ? data[lastNameKey] : "";
    const phoneKey = keys.find(k => k.toLowerCase().includes("phone") || k.toLowerCase().includes("mobile"));
    const phone = phoneKey ? data[phoneKey] : null;

    if (!email) {
      return { status: "error", message: "Could not find an email address in the submission data." };
    }

    // Create Customer in Shopify
    let response;
    try {
      response = await admin.graphql(
        `#graphql
            mutation customerCreate($input: CustomerInput!) {
                customerCreate(input: $input) {
                    customer {
                        id
                        email
                    }
                    userErrors {
                        field
                        message
                    }
                }
            }`,
        {
          variables: {
            input: {
              email: email,
              firstName: firstName,
              lastName: lastName,
              phone: phone,
              tags: ["B2B_approved"]
            }
          }
        }
      );
    } catch (error) {
      console.error("Customer Access Error:", error);
      return {
        status: "error",
        message: `Error: ${error.message || JSON.stringify(error)}`
      };
    }

    const responseJson = await response.json();
    const userErrors = responseJson.data?.customerCreate?.userErrors;

    if (userErrors && userErrors.length > 0) {
      if (userErrors[0].message.includes("taken")) {
        try {
          const customerQuery = await admin.graphql(
            `#graphql
               query getCustomer($query: String!) {
                 customers(first: 1, query: $query) {
                   edges {
                      node {
                        id
                        tags
                        firstName
                        lastName
                        phone
                      }
                   }
                 }
               }`,
            { variables: { query: `email:${email}` } }
          );
          const customerJson = await customerQuery.json();
          const existingCustomer = customerJson.data?.customers?.edges?.[0]?.node;

          if (existingCustomer) {
            let currentTags = existingCustomer.tags || [];
            // Remove B2B_rejected if present
            currentTags = currentTags.filter(tag => tag !== "B2B_rejected");
            if (!currentTags.includes("B2B_approved")) {
              currentTags.push("B2B_approved");
            }

            // Prepare customer input with updated details if different
            const customerInput = {
              id: existingCustomer.id,
              tags: currentTags
            };

            // Update firstName if different
            if (firstName && firstName !== existingCustomer.firstName) {
              customerInput.firstName = firstName;
            }

            // Update lastName if different
            if (lastName && lastName !== existingCustomer.lastName) {
              customerInput.lastName = lastName;
            }

            // Update phone if different
            if (phone && phone !== existingCustomer.phone) {
              customerInput.phone = phone;
            }

            const updateResponse = await admin.graphql(
              `#graphql
                  mutation updateCustomer($input: CustomerInput!) {
                    customerUpdate(input: $input) {
                      userErrors {
                        field
                        message
                      }
                    }
                  }`,
              { variables: { input: customerInput } }
            );
            const updateJson = await updateResponse.json();
            if (updateJson.data?.customerUpdate?.userErrors?.length > 0) {
              return { status: "error", message: "Failed to update tags: " + updateJson.data.customerUpdate.userErrors[0].message };
            }
          } else {
            return { status: "error", message: "Email taken but could not find existing customer." };
          }
        } catch (error) {
          console.error("Customer Access Error (Upsert):", error);
          return {
            status: "error",
            message: `Error: ${error.message || JSON.stringify(error)}`
          };
        }
      } else {
        return { status: "error", message: "Shopify Error: " + userErrors[0].message };
      }
    }

    await db.formSubmission.update({
      where: { id: parseInt(submissionId) },
      data: { status: "APPROVED" }
    });

    return { status: "success", message: "Submission approved." };
  }

  return { status: "ignored" };
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

import { useState, useEffect } from "react";

export default function Forms() {
  const { forms, recentSubmissions } = useLoaderData();
  const navigate = useNavigate();
  const submit = useSubmit();
  const actionData = useActionData();
  const [selectedTab, setSelectedTab] = useState(0);

  useEffect(() => {
    if (actionData) {
      if (actionData.status === 'success') {
        shopify.toast.show(actionData.message);
      } else if (actionData.status === 'error') {
        shopify.toast.show(actionData.message, { isError: true });
      }
    }
  }, [actionData]);

  const tabs = [
    { id: 'all', content: 'All' },
    { id: 'pending', content: 'Pending' },
    { id: 'approved', content: 'Approved' },
    { id: 'rejected', content: 'Rejected' },
  ];

  const filteredSubmissions = recentSubmissions.filter((sub) => {
    switch (selectedTab) {
      case 1: // Pending
        return !sub.status || sub.status === 'PENDING';
      case 2: // Approved
        return sub.status === 'APPROVED';
      case 3: // Rejected
        return sub.status === 'REJECTED';
      default: // All
        return true;
    }
  });

  const handleDelete = (id) => {
    submit({ id, intent: "delete" }, { method: "post" });
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleString();
  };

  // Helper to nicely format the JSON data
  const formatData = (jsonStr) => {
    try {
      const data = JSON.parse(jsonStr);
      return Object.entries(data).map(([k, v]) => `${k}: ${v}`).join(', ');
    } catch (e) {
      return jsonStr;
    }
  };


  return (
    <s-page>
      <TitleBar title="Custom Forms" />
      <s-box paddingBlockStart="large">
        <s-section>
          {forms.length === 0 ? (
            <EmptyState
              heading="Create your form"
              action={{ content: "Create Form", url: "/app/forms/new" }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Build custom form to collect information from your customers.</p>
            </EmptyState>
          ) : (
            <s-stack>
              <s-text variant="headingLg" type="strong">Your Form</s-text>
              {forms.map((item, index) => (
                <div
                  key={item.id}
                  style={{
                    padding: '12px 16px',
                    borderTop: index === 0 ? 'none' : '1px solid #e1e3e5'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <s-stack>
                      <s-paragraph>
                        <s-text type="strong">Form Name: </s-text>
                        <s-text>{item.title}</s-text>
                      </s-paragraph>
                      <s-paragraph>
                        <s-text type="strong">Field count: </s-text>
                        <s-text>{JSON.parse(item.fields).length}</s-text>
                      </s-paragraph>
                    </s-stack>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <s-button onClick={() => navigate(`/app/forms/${item.id}`)}>Edit</s-button>
                      <s-button tone="critical" onClick={() => handleDelete(item.id)}>Delete</s-button>
                    </div>
                  </div>
                </div>
              ))}
            </s-stack>
          )}
        </s-section>

        {recentSubmissions && recentSubmissions.length > 0 && (
          <s-box paddingBlockStart="large">
            <s-section>
              <s-text type="strong">Form Submissions</s-text>
              <div style={{ 
                display: 'flex', 
                gap: '0', 
                borderBottom: '1px solid #e1e3e5', 
                marginBottom: '16px',
                marginTop: '12px'
              }}>
                {tabs.map((tab, index) => (
                  <button
                    key={tab.id}
                    onClick={() => setSelectedTab(index)}
                    style={{
                      padding: '12px 16px',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      borderBottom: selectedTab === index ? '2px solid #2c6ecb' : '2px solid transparent',
                      color: selectedTab === index ? '#2c6ecb' : '#202223',
                      fontWeight: selectedTab === index ? '600' : '400',
                      fontSize: '14px',
                      transition: 'all 0.2s ease',
                      fontFamily: '-apple-system, BlinkMacSystemFont, San Francisco, Segoe UI, Roboto, Helvetica Neue, sans-serif',
                      marginBottom: '-1px'
                    }}
                    onMouseEnter={(e) => {
                      if (selectedTab !== index) {
                        e.currentTarget.style.color = '#2c6ecb';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selectedTab !== index) {
                        e.currentTarget.style.color = '#202223';
                      }
                    }}
                  >
                    {tab.content}
                  </button>
                ))}
              </div>

              {filteredSubmissions.length === 0 ? (
                <EmptyState
                  heading="No submissions found"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>No submissions match the selected filter.</p>
                </EmptyState>
              ) : (
                  <s-table>
                    <s-table-header-row>
                      <s-table-header>Customer Details</s-table-header>
                      <s-table-header>Status</s-table-header>
                      <s-table-header>Date</s-table-header>
                      <s-table-header>Actions</s-table-header>
                    </s-table-header-row>
                    <s-table-body>
                      {filteredSubmissions.map(
                        (sub, index) => {
                          const data = JSON.parse(sub.data);
                          return (
                            <s-table-row key={sub.id}>
                              <s-table-cell>
                                <div style={{ whiteSpace: 'pre-wrap' }}>
                                  {Object.entries(data).map(([k, v]) => (
                                    <div key={k}>
                                      <strong>{k}:</strong>{" "}
                                      {typeof v === "object" && v !== null ? (
                                        v._type === "file" ? (
                                          (() => {
                                            const isImage = v.name?.match(/\.(jpg|jpeg|png|gif|webp)$/i);
                                            const isPdf = v.name?.match(/\.pdf$/i);

                                            if (isImage) {
                                              return (
                                                <a href={v.content} download={v.name} target="_blank" rel="noopener noreferrer" style={{ display: 'block', width: '100px' }}>
                                                  <img
                                                    src={v.content}
                                                    alt={v.name}
                                                    style={{
                                                      width: '100px',
                                                      height: '100px',
                                                      objectFit: 'cover',
                                                      border: '1px solid #ccc',
                                                      borderRadius: '4px'
                                                    }}
                                                  />
                                                </a>
                                              );
                                            } else if (isPdf) {
                                              return (
                                                <a href={v.content} download={v.name} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                  <div style={{
                                                    width: '100px',
                                                    height: '100px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    border: '1px solid #ccc',
                                                    borderRadius: '4px',
                                                    backgroundColor: '#f4f6f8'
                                                  }}>
                                                    <span style={{ fontSize: '24px', color: '#d82c2c' }}>PDF</span>
                                                  </div>
                                                </a>
                                              );
                                            }
                                            return (
                                              <a href={v.content} download={v.name} target="_blank" rel="noopener noreferrer">
                                                Download {v.name}
                                              </a>
                                            );
                                          })()
                                        ) : JSON.stringify(v)
                                      ) : v}
                                    </div>
                                  ))}
                                </div>
                              </s-table-cell>
                              <s-table-cell>
                                {sub.status === 'APPROVED' ? (
                                  <s-badge tone="success">Approved</s-badge>
                                ) : sub.status === 'REJECTED' ? (
                                  <s-badge tone="critical">Rejected</s-badge>
                                ) : (
                                  <s-badge tone="attention">Pending</s-badge>
                                )}
                              </s-table-cell>
                              <s-table-cell>{formatDate(sub.createdAt)}</s-table-cell>
                              <s-table-cell>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  {sub.status !== 'APPROVED' && (
                                      <s-button
                                        size="slim"
                                        variant="primary"
                                        onClick={() => submit({ intent: 'approve', submissionId: sub.id }, { method: 'post' })}
                                      >
                                        Approve
                                      </s-button>
                                    )}
                                  {sub.status !== 'REJECTED' && (
                                      <s-button
                                        size="slim"
                                        tone="critical"
                                        onClick={() => submit({ intent: 'reject', submissionId: sub.id }, { method: 'post' })}
                                      >
                                        Reject
                                      </s-button>
                                    )}
                                </div>
                              </s-table-cell>
                            </s-table-row>
                          )
                        }
                      )}
                    </s-table-body>
                  </s-table>
              )}
            </s-section>
          </s-box>
        )}
      </s-box>
    </s-page>
  );
}
