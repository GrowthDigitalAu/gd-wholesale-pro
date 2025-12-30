import { useLoaderData, useSubmit, useNavigation, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Page, Layout, Card, IndexTable, Text, Button, EmptyState, useIndexResourceState } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  
  const form = await db.form.findUnique({
    where: { 
      id: parseInt(params.id),
      shop: session.shop 
    },
    include: {
      submissions: {
        orderBy: { createdAt: 'desc' }
      }
    }
  });

  if (!form) {
    throw new Response("Not Found", { status: 404 });
  }

  return { form, submissions: form.submissions };
};

export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const submissionId = formData.get("id");

  if (request.method === "DELETE") {
     await db.formSubmission.delete({
         where: { id: parseInt(submissionId) }
     });
     return { status: "success" };
  }
  return null;
};

export default function Submissions() {
  const { form, submissions } = useLoaderData();
  const submit = useSubmit();

  const resourceName = {
    singular: 'submission',
    plural: 'submissions',
  };

  const {selectedResources, allResourcesSelected, handleSelectionChange} =
    useIndexResourceState(submissions);

  // Parse fields to create table headers
  const formFields = JSON.parse(form.fields || '[]');
  
  // Create row data
  const rowData = submissions.map(sub => {
      const data = JSON.parse(sub.data);
      return {
          id: sub.id,
          createdAt: new Date(sub.createdAt).toLocaleString(),
          ...data
      };
  });

  const handleDelete = (id) => {
      submit({ id }, { method: 'DELETE' });
  };

  return (
    <Page>
      <TitleBar title={`Submissions for "${form.title}"`} />
      <Layout>
        <Layout.Section>
          <Card padding="0">
            {submissions.length === 0 ? (
                <EmptyState
                    heading="No submissions yet"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                    <p>When customers fill out your form, their responses will appear here.</p>
                </EmptyState>
            ) : (
                <IndexTable
                  resourceName={resourceName}
                  itemCount={submissions.length}
                  selectedItemsCount={
                    allResourcesSelected ? 'All' : selectedResources.length
                  }
                  onSelectionChange={handleSelectionChange}
                  headings={[
                    {title: 'Date'},
                    ...formFields.map(f => ({ title: f.label })),
                    {title: 'Actions'}
                  ]}
                >
                  {rowData.map((row, index) => (
                    <IndexTable.Row
                      id={row.id}
                      key={row.id}
                      selected={selectedResources.includes(row.id)}
                      position={index}
                    >
                      <IndexTable.Cell>
                        <Text variant="bodyMd" fontWeight="bold" as="span">{row.createdAt}</Text>
                      </IndexTable.Cell>
                      
                      {formFields.map(f => (
                          <IndexTable.Cell key={f.id}>
                          {(() => {
                            const val = row[f.label];
                            if (val && typeof val === 'object' && val._type === 'file') {
                              return (
                                <a href={val.content} download={val.name} style={{ textDecoration: 'none', color: '#2c6ecb', fontWeight: 500 }}>
                                  Download {val.name.length > 20 ? val.name.substring(0, 20) + '...' : val.name}
                                </a>
                              );
                            }
                            return typeof val === 'object' ? JSON.stringify(val) : (val || '-');
                          })()}
                          </IndexTable.Cell>
                      ))}

                       <IndexTable.Cell>
                           <Button tone="critical" onClick={() => handleDelete(row.id)} size="micro">Delete</Button>
                       </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
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
