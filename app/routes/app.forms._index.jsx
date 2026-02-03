import { useLoaderData, Link, useRouteError, useSubmit, useActionData, useNavigate, useNavigation, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { EmptyState, Pagination } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { COUNTRY_CODES } from "../country_codes";

const formatPhoneNumber = (rawPhone) => {
  if (!rawPhone) return null;

  let cleanPhone = rawPhone.replace(/[^0-9+]/g, "");

  if (cleanPhone.startsWith("+")) {
      const sortedCodes = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length);
      
      const matchedMeta = sortedCodes.find(c => cleanPhone.startsWith(c.code));
      
      if (matchedMeta) {
          const prefix = matchedMeta.code;
          const numberPart = cleanPhone.substring(prefix.length);

          if (numberPart.startsWith("0")) {
              cleanPhone = prefix + numberPart.substring(1);
          }
      }
  }

  return cleanPhone;
};

export const loader = async ({ request }) => {
  try {
    const { session, admin } = await authenticate.admin(request);
    
    // Check for active subscription to prevent slow DB loading for unbilled users
    const billingCheck = await admin.graphql(
      `#graphql
        query {
          currentAppInstallation {
            activeSubscriptions {
              id
              status
              test
            }
          }
        }
      `
    );

    const billingJson = await billingCheck.json();
    const activeSubscriptions =
      billingJson.data?.currentAppInstallation?.activeSubscriptions || [];

    if (activeSubscriptions.length < 1) {
       return { 
          forms: [], 
          recentSubmissions: [], 
          pagination: { currentPage: 1, totalPages: 1, totalCount: 0, hasNextPage: false, hasPreviousPage: false }, 
          activeTab: "all", 
          totalSubmissionsCount: 0 
       };
    }

    const forms = await db.form.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
    });

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1");
    const tab = url.searchParams.get("tab") || "all";
    const limit = 10;
    const skip = (page - 1) * limit;

    let where = {
      form: {
        shop: session.shop
      }
    };

    if (tab === 'pending') {
      where = {
        ...where,
        status: {
          notIn: ['APPROVED', 'REJECTED']
        }
      };
    } else if (tab === 'approved') {
      where.status = 'APPROVED';
    } else if (tab === 'rejected') {
      where.status = 'REJECTED';
    }

    let recentSubmissions = [];
    let pagination = {
      currentPage: 1,
      totalPages: 1,
      totalCount: 0,
      hasNextPage: false,
      hasPreviousPage: false
    };

    try {
      const totalCount = await db.formSubmission.count({ where });
      const totalPages = Math.ceil(totalCount / limit);

      recentSubmissions = await db.formSubmission.findMany({
        where,
        take: limit,
        skip: skip,
        orderBy: { createdAt: "desc" },
        include: {
          form: {
            select: { title: true }
          }
        }
      });

      pagination = {
        currentPage: page,
        totalPages,
        totalCount,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      };

    } catch (dbError) {
      console.log("Failed to fetch recent submissions:", dbError);
    }

    const totalSubmissionsCount = await db.formSubmission.count({
      where: {
        form: {
          shop: session.shop
        }
      }
    });

    return { forms, recentSubmissions, pagination, activeTab: tab, totalSubmissionsCount };
  } catch (error) {
    throw error;
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

  if (intent === "reject" || intent === "approve") {
    if (!submissionId) return { status: "error", message: "Submission ID required" };

    const submission = await db.formSubmission.findUnique({
      where: { id: parseInt(submissionId) }
    });
    const data = JSON.parse(submission.data);

    const keys = Object.keys(data);
    const emailKey = keys.find(k => k.toLowerCase().includes("email"));
    const firstNameKey = keys.find(k => k.toLowerCase().includes("first"));
    const lastNameKey = keys.find(k => k.toLowerCase().includes("last"));
    const nameKey = keys.find(k => k.toLowerCase() === "name" || k.toLowerCase().includes("name"));
    const phoneKey = keys.find(k => k.toLowerCase().includes("phone") || k.toLowerCase().includes("mobile"));

    const email = emailKey ? data[emailKey] : null;
    const firstName = firstNameKey ? data[firstNameKey] : (nameKey ? data[nameKey] : "");
    const lastName = lastNameKey ? data[lastNameKey] : "";
    const phone = phoneKey && data[phoneKey] ? formatPhoneNumber(data[phoneKey]) : null;

    if (!email) {
      return { status: "error", message: "Could not find an email address in the submission data." };
    }


    let existingCustomer = null;

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
      existingCustomer = customerJson.data?.customers?.edges?.[0]?.node;
    } catch (error) {
      return { status: "error", message: "Failed to check customer existence." };
    }

    if (existingCustomer) {
      let tags = existingCustomer.tags || [];
      const tagToRemove = intent === "approve" ? "B2B_rejected" : "B2B_approved";
      const tagToAdd = intent === "approve" ? "B2B_approved" : "B2B_rejected";

      tags = tags.filter(tag => tag !== tagToRemove);
      if (!tags.includes(tagToAdd)) tags.push(tagToAdd);


      const customerInput = {
        id: existingCustomer.id,
        tags: tags
      };
      if (firstName) customerInput.firstName = firstName;
      if (lastName) customerInput.lastName = lastName;

      try {
        await admin.graphql(
          `#graphql
          mutation updateCustomer($input: CustomerInput!) {
            customerUpdate(input: $input) {
              userErrors { message }
            }
          }`,
          { variables: { input: customerInput } }
        );
      } catch (error) {
         return { status: "error", message: "Error updating customer status." };
      }

      if (phone) {
          try {
              await admin.graphql(
              `#graphql
              mutation updateCustomer($input: CustomerInput!) {
                customerUpdate(input: $input) {
                  userErrors { message }
                }
              }`,
              { variables: { input: { id: existingCustomer.id, phone: phone } } }
            );
          } catch (e) {
             console.log("Failed to update phone (system error):", e);
          }
      }

    } else {
      const tagToAdd = intent === "approve" ? "B2B_approved" : "B2B_rejected";
      
      const createInput = {
        email: email,
        firstName: firstName,
        lastName: lastName,
        phone: phone,
        tags: [tagToAdd]
      };

      const createResponse = await admin.graphql(
        `#graphql
        mutation customerCreate($input: CustomerInput!) {
          customerCreate(input: $input) {
            customer { id }
            userErrors { field message }
          }
        }`,
        { variables: { input: createInput } }
      );
      
      const createJson = await createResponse.json();
      
      if (createJson.data?.customerCreate?.userErrors?.length > 0) {
          const errors = createJson.data.customerCreate.userErrors;
          const hasPhoneError = errors.some(e => e.field && e.field.includes('phone'));

          if (hasPhoneError) {
              const inputNoPhone = { ...createInput };
              delete inputNoPhone.phone;

               const retryResponse = await admin.graphql(
                `#graphql
                mutation customerCreate($input: CustomerInput!) {
                  customerCreate(input: $input) {
                    userErrors { message }
                  }
                }`,
                { variables: { input: inputNoPhone } }
              );
              const retryJson = await retryResponse.json();
              if (retryJson.data?.customerCreate?.userErrors?.length > 0) {
                   return { status: "error", message: "Failed to create customer (retry): " + retryJson.data.customerCreate.userErrors[0].message };
              }
          } else {
               return { status: "error", message: "Failed to create customer: " + errors[0].message };
          }
      }
    }

    await db.formSubmission.update({
      where: { id: parseInt(submissionId) },
      data: { status: intent === "approve" ? "APPROVED" : "REJECTED" }
    });

    const pastTense = intent === "approve" ? "approved" : "rejected";
    return { status: "success", message: `Submission ${pastTense}.` };
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
  const { forms, recentSubmissions, pagination, activeTab, totalSubmissionsCount } = useLoaderData();
  const navigate = useNavigate();
  const submit = useSubmit();
  const navigation = useNavigation();
  const actionData = useActionData();
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (actionData) {
      if (actionData.status === 'success') {
        shopify.toast.show(actionData.message);
      } else if (actionData.status === 'error') {
        shopify.toast.show(actionData.message, { isError: true });
      }
    }
  }, [actionData]);

  const startItem = (pagination.currentPage - 1) * 10 + 1;
  const endItem = Math.min(startItem + recentSubmissions.length - 1, pagination.totalCount);
  const paginationLabel = pagination.totalCount > 0 
    ? `${startItem}-${endItem} of ${pagination.totalCount} submissions` 
    : "No submissions";

  const tabs = [
    { id: 'all', content: 'All' },
    { id: 'pending', content: 'Pending' },
    { id: 'approved', content: 'Approved' },
    { id: 'rejected', content: 'Rejected' },
  ];

  const handleTabChange = (tabId) => {
    setSearchParams({ tab: tabId, page: '1' });
  };

  const handlePageChange = (newPage) => {
    setSearchParams({ tab: activeTab, page: String(newPage) });
  };

  // We use recentSubmissions directly now as it is filtered by the server
  const filteredSubmissions = recentSubmissions;

  const handleDelete = (id) => {
    submit({ id, intent: "delete" }, { method: "post" });
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleString();
  };

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
      <TitleBar title="Custom Form" />
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

        {totalSubmissionsCount > 0 && (
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
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id)}
                    style={{
                      padding: '12px 16px',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      borderBottom: activeTab === tab.id ? '2px solid #2c6ecb' : '2px solid transparent',
                      color: activeTab === tab.id ? '#2c6ecb' : '#202223',
                      fontWeight: activeTab === tab.id ? '600' : '400',
                      fontSize: '14px',
                      transition: 'all 0.2s ease',
                      fontFamily: '-apple-system, BlinkMacSystemFont, San Francisco, Segoe UI, Roboto, Helvetica Neue, sans-serif',
                      marginBottom: '-1px'
                    }}
                    onMouseEnter={(e) => {
                      if (activeTab !== tab.id) {
                        e.currentTarget.style.color = '#2c6ecb';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (activeTab !== tab.id) {
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
                          const isSubmitting = navigation.state === "submitting" && navigation.formData.get("submissionId") === String(sub.id);
                          const submittingIntent = isSubmitting ? navigation.formData.get("intent") : null;

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
                                      ) : (
                                        typeof v === 'string' && (k.toLowerCase().includes('phone') || k.toLowerCase().includes('mobile')) ? v.replace(/-/g, "") : v
                                      )}
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
                                        loading={submittingIntent === 'approve'}
                                        onClick={() => submit({ intent: 'approve', submissionId: sub.id }, { method: 'post' })}
                                      >
                                        Approve
                                      </s-button>
                                    )}
                                  {sub.status !== 'REJECTED' && (
                                      <s-button
                                        size="slim"
                                        tone="critical"
                                        loading={submittingIntent === 'reject'}
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

             {pagination.totalPages > 1 && (
                <Pagination
                  hasPrevious={pagination.hasPreviousPage}
                  onPrevious={() => handlePageChange(pagination.currentPage - 1)}
                  hasNext={pagination.hasNextPage}
                  onNext={() => handlePageChange(pagination.currentPage + 1)}
                  type="table"
                  label={paginationLabel}
                />
              )}
            </s-section>
          </s-box>
        )}
      </s-box>
    </s-page>
  );
}
