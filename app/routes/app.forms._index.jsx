import { useLoaderData, Link, useRouteError, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Page, Layout, Card, ResourceList, ResourceItem, Text, Button, EmptyState, IndexTable, BlockStack } from "@shopify/polaris";
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
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const formId = formData.get("id");
  const intent = formData.get("intent");

  if (intent === "delete" && formId) {
    await db.form.deleteMany({
      where: {
        id: parseInt(formId),
        shop: session.shop,
      },
    });
    return { status: "success" };
  }
  return { status: "ignored" };
};

export default function Forms() {
  const { forms, recentSubmissions } = useLoaderData();
  const submit = useSubmit();

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

  const rowMarkup = recentSubmissions.map(
    ({ id, form, createdAt, data, formId }, index) => (
      <IndexTable.Row id={id} key={id} position={index}>
        <IndexTable.Cell><Text fontWeight="bold">{form.title}</Text></IndexTable.Cell>
        <IndexTable.Cell>{formatDate(createdAt)}</IndexTable.Cell>
        <IndexTable.Cell>
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '400px' }}>
            {formatData(data)}
          </div>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Link to={`/app/forms/${formId}/submissions`}>View All</Link>
        </IndexTable.Cell>
      </IndexTable.Row>
    ),
  );

  return (
    <Page>
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
              <Card padding="0">
                <div style={{ padding: '16px 16px 0 16px' }}>
                  <Text variant="headingMd" as="h2">Recent Submissions</Text>
                </div>
                <IndexTable
                  resourceName={{ singular: 'submission', plural: 'submissions' }}
                  itemCount={recentSubmissions.length}
                  headings={[
                    { title: 'Form' },
                    { title: 'Date' },
                    { title: 'Data Snippet' },
                    { title: 'Action' },
                  ]}
                  selectable={false}
                >
                  {rowMarkup}
                </IndexTable>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
