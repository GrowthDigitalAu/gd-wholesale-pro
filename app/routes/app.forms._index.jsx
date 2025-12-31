import { useLoaderData, Link, useRouteError, useSubmit, useActionData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Page, Layout, Card, ResourceList, ResourceItem, Text, Button, EmptyState, IndexTable, BlockStack, Tabs, Badge, ButtonGroup } from "@shopify/polaris";
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
    await db.form.deleteMany({
      where: {
        id: parseInt(formId),
        shop: session.shop,
      },
    });
    return { status: "success" };
  }

  if (intent === "approve" || intent === "reject") {
    if (!submissionId) return { status: "error", message: "Submission ID required" };

    if (intent === "reject") {
      await db.formSubmission.update({
        where: { id: parseInt(submissionId) },
        data: { status: "REJECTED" }
      });
      return { status: "success", message: "Submission rejected" };
    }

    // Approve Logic
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
              tags: ["B2B_customer"]
            }
          }
        }
      );
    } catch (error) {
      console.error("Customer Access Error:", error);
      return {
        status: "error",
        message: "App does not have access to Customer data. Please approve 'Protected Customer Data' in Partner Dashboard."
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
                     }
                   }
                 }
               }`,
            { variables: { query: `email:${email}` } }
          );
          const customerJson = await customerQuery.json();
          const existingCustomer = customerJson.data?.customers?.edges?.[0]?.node;

          if (existingCustomer) {
            const currentTags = existingCustomer.tags || [];
            if (!currentTags.includes("B2B_customer")) {
              const newTags = [...currentTags, "B2B_customer"];
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
                { variables: { input: { id: existingCustomer.id, tags: newTags } } }
              );
              const updateJson = await updateResponse.json();
              if (updateJson.data?.customerUpdate?.userErrors?.length > 0) {
                return { status: "error", message: "Failed to update tags: " + updateJson.data.customerUpdate.userErrors[0].message };
              }
            }
          } else {
            return { status: "error", message: "Email taken but could not find existing customer." };
          }
        } catch (error) {
          console.error("Customer Access Error (Upsert):", error);
          return {
            status: "error",
            message: "App does not have access to Customer data to update existing customer. Please approve 'Protected Customer Data' in Partner Dashboard."
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
      <s-section heading="Puzzle information">
        <s-grid gap="base">

        </s-grid>
      </s-section>
      <TitleBar title="Custom Forms" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <Card>
              <BlockStack gap="200">
                <Text variant="headingMd" as="h2">Your Forms</Text>
                {forms.length === 0 ? (
                  <EmptyState
                    heading="Create your form"
                    action={{ content: "Create Form", url: "/app/forms/new" }}
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>Build custom forms to collect information from your customers.</p>
                  </EmptyState>
                ) : (
                  <ResourceList
                    resourceName={{ singular: "form", plural: "forms" }}
                    items={forms}
                    renderItem={(item) => (
                      <ResourceItem
                        id={item.id}
                        url={`/app/forms/${item.id}`}
                        accessibilityLabel={`View details for ${item.title}`}
                        shortcutActions={[
                          {
                            content: 'Edit',
                            url: `/app/forms/${item.id}`,
                          },
                          {
                            content: 'Delete',
                            destructive: true,
                            onAction: () => handleDelete(item.id),
                          },
                        ]}
                      >
                        <Text variant="bodyMd" fontWeight="bold" as="h3">
                          {item.title}
                        </Text>
                        <div>Field count: {JSON.parse(item.fields).length}</div>
                      </ResourceItem>
                    )}
                  />
                )}
              </BlockStack>
            </Card>

            {recentSubmissions && recentSubmissions.length > 0 && (
              <BlockStack gap="200">
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">Form Submissions</Text>
                    {/* <s-text variant="headingMd" as="h2">Your Section Title</s-text> */}
                    {/* <Text variant="headingXl" as="h2" style={{ padding: '3px 10px 20px 10px', display: 'block' }}>Recent Submissions</Text> */}
                    <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} />

                    {filteredSubmissions.length === 0 ? (
                      <EmptyState
                        heading="No submissions found"
                        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                      >
                        <p>No submissions match the selected filter.</p>
                      </EmptyState>
                    ) : (
                        <IndexTable
                          resourceName={{ singular: 'submission', plural: 'submissions' }}
                          itemCount={filteredSubmissions.length}
                          headings={[
                            { title: 'Customer Details' },
                            { title: 'Status' },
                            { title: 'Date' },
                            { title: 'Actions' }
                          ]}
                          selectable={false}
                        >
                          {filteredSubmissions.map(
                            (sub, index) => {
                              const data = JSON.parse(sub.data);
                              return (
                                <IndexTable.Row id={sub.id} key={sub.id} position={index}>
                                  <IndexTable.Cell>
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
                                  </IndexTable.Cell>
                                  <IndexTable.Cell>
                                    {sub.status === 'APPROVED' ? (
                                      <Badge tone="success">Approved</Badge>
                                    ) : sub.status === 'REJECTED' ? (
                                      <Badge tone="critical">Rejected</Badge>
                                    ) : (
                                      <Badge tone="attention">Pending</Badge>
                                    )}
                                  </IndexTable.Cell>
                                  <IndexTable.Cell>{formatDate(sub.createdAt)}</IndexTable.Cell>
                                  <IndexTable.Cell>
                                    <ButtonGroup>
                                      {sub.status !== 'APPROVED' && (
                                        <Button
                                          size="slim"
                                          variant="primary"
                                          onClick={() => submit({ intent: 'approve', submissionId: sub.id }, { method: 'post' })}
                                        >
                                          Approve
                                        </Button>
                                      )}
                                      {sub.status !== 'REJECTED' && (
                                        <Button
                                          size="slim"
                                          tone="critical"
                                          onClick={() => submit({ intent: 'reject', submissionId: sub.id }, { method: 'post' })}
                                        >
                                          Reject
                                        </Button>
                                      )}
                                    </ButtonGroup>
                                  </IndexTable.Cell>
                                </IndexTable.Row>
                              )
                            }
                          )}
                        </IndexTable>
                    )}
                  </BlockStack>
                </Card>
              </BlockStack>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </s-page>
  );
}
