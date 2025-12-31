import { useLoaderData, Link, useRouteError, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Page, Layout, Card, ResourceList, ResourceItem, Text, Button, EmptyState } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const forms = await db.form.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
  });
  return { forms };
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
  const { forms } = useLoaderData();
  const submit = useSubmit();

  const handleDelete = (id) => {
    submit({ id, intent: "delete" }, { method: "post" });
  };

  return (
    <Page
      title="Custom Forms"
    >
      <Layout>
        <Layout.Section>
          <Card>
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
          </Card>
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
