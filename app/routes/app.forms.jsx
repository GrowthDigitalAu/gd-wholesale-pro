import { useLoaderData, Link, useRouteError } from "react-router";
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

export default function Forms() {
  const { forms } = useLoaderData();

  return (
    <Page
      title="Custom Forms"
      primaryAction={
        <Button variant="primary" url="/app/forms/new">Create Form</Button>
      }
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
