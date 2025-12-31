import { useLoaderData, useSubmit, useNavigation, Form as RemixForm, redirect, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Page, Layout, Card, TextField, Button, BlockStack, Box, Card as PolarisCard, Text, Select, Checkbox, InlineStack, Banner } from "@shopify/polaris";
import { useState, useEffect } from "react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  if (params.id === "new") {
    const existingCount = await db.form.count({
      where: { shop: session.shop },
    });
    if (existingCount > 0) {
      // Limit reached, redirect to the existing form or list
      const existingForm = await db.form.findFirst({
        where: { shop: session.shop },
      });
      return redirect(`/app/forms/${existingForm.id}`);
    }
    return { form: null };
  }

  const form = await db.form.findUnique({
    where: { id: parseInt(params.id) },
  });

  if (!form || form.shop !== session.shop) {
    return redirect("/app/forms");
  }

  return { form };
};

export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const title = formData.get("title");
  const fields = formData.get("fields");

  if (params.id === "new") {
    const existingCount = await db.form.count({
      where: { shop: session.shop },
    });
    if (existingCount > 0) {
      return { status: "error", message: "Form limit reached (Max 1)." };
    }

    const form = await db.form.create({
      data: {
        title,
        fields,
        shop: session.shop,
      },
    });
    return redirect(`/app/forms/${form.id}`);
  } else {
    await db.form.update({
      where: { id: parseInt(params.id) },
      data: {
        title,
        fields,
      },
    });
    return { status: "success" };
  }
};

export default function FormEditor() {
  const { form } = useLoaderData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [title, setTitle] = useState(form?.title || "");
  const [fields, setFields] = useState(form ? JSON.parse(form.fields) : []);
  const [activeField, setActiveField] = useState(null);

  // Field Types
  const fieldTypes = [
    { label: "Text (Single Line)", value: "text" },
    { label: "Text (Multi Line)", value: "textarea" },
    { label: "Email", value: "email" },
    { label: "Number", value: "number" },
    { label: "Dropdown", value: "select" },
    { label: "Checkbox", value: "checkbox" },
  ];

  const addField = (type) => {
    const newField = {
      id: Date.now().toString(),
      type,
      label: "New Field",
      required: false,
      options: [], // For select
    };
    setFields([...fields, newField]);
    setActiveField(newField.id);
  };

  const updateField = (id, key, value) => {
    setFields(fields.map(f => f.id === id ? { ...f, [key]: value } : f));
  };

  const removeField = (id) => {
    setFields(fields.filter(f => f.id !== id));
    if (activeField === id) setActiveField(null);
  };

  const handleSave = () => {
    const formData = new FormData();
    formData.append("title", title);
    formData.append("fields", JSON.stringify(fields));
    submit(formData, { method: "post" });
  };

  return (
    <Page
      title={form ? "Edit Form" : "Create New Form"}
      backAction={{ url: "/app/forms" }}
      primaryAction={{
        content: "Save",
        loading: isSaving,
        onAction: handleSave,
      }}
    >
      <Layout>
        {/* Left: Form Preview & Configuration */}
        <Layout.Section>
           <Card>
              <BlockStack gap="400">
                <TextField label="Form Title" value={title} onChange={setTitle} autoComplete="off" />
                
                <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                    <Text variant="headingSm" as="h5">Form Preview</Text>
                    <div style={{ marginTop: '1rem' }}>
                        {fields.length === 0 && <Text tone="subdued">No fields added yet.</Text>}
                        {fields.map((field) => (
                          <div 
                              key={field.id} 
                              onClick={() => setActiveField(field.id)}
                              style={{ 
                                  padding: '10px', 
                                  border: activeField === field.id ? '2px solid #5c6ac4' : '1px solid #e1e3e5', 
                                  borderRadius: '4px',
                                  marginBottom: '10px',
                                  cursor: 'pointer',
                                  background: 'white'
                              }}
                          >
                              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px'}}>
                                  {field.label} {field.required && <span style={{color:'red'}}>*</span>}
                              </label>
                              {field.type === 'textarea' ? (
                                  <textarea disabled style={{width: '100%', padding: '5px'}} />
                              ) : field.type === 'select' ? (
                                  <select disabled style={{width: '100%', padding: '5px'}}>
                                      <option>Select...</option>
                                      {field.options?.map(opt => <option key={opt}>{opt}</option>)}
                                  </select>
                              ) : field.type === 'checkbox' ? (
                                  <input type="checkbox" disabled />
                              ) : (
                                  <input type={field.type} disabled style={{width: '100%', padding: '5px'}} />
                              )}
                          </div>
                        ))}
                    </div>
                </Box>
              </BlockStack>
           </Card>
        </Layout.Section>

        {/* Right: Toolbox */}
        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
             <Card>
                <BlockStack gap="400">
                    <Text variant="headingSm" as="h5">Add Field</Text>
                    <InlineStack gap="200" wrap>
                        {fieldTypes.map(ft => (
                            <Button key={ft.value} onClick={() => addField(ft.value)} size="micro">{ft.label}</Button>
                        ))}
                    </InlineStack>
                </BlockStack>
             </Card>

             {activeField && (
               <Card>
                   <BlockStack gap="400">
                      <Text variant="headingSm" as="h5">Edit Field</Text>
                      {(() => {
                          const field = fields.find(f => f.id === activeField);
                          if (!field) return null;
                          return (
                              <>
                                  <TextField 
                                      label="Label" 
                                      value={field.label} 
                                      onChange={(val) => updateField(field.id, 'label', val)} 
                                      autoComplete="off"
                                  />
                                  <Checkbox 
                                      label="Required" 
                                      checked={field.required} 
                                      onChange={(val) => updateField(field.id, 'required', val)} 
                                  />
                                  {field.type === 'select' && (
                                     <TextField
                                         label="Options (comma separated)"
                                         value={field.options?.join(', ')}
                                         onChange={(val) => updateField(field.id, 'options', val.split(',').map(s => s.trim()))}
                                         autoComplete="off"
                                         helpText="Example: Red, Blue, Green"
                                     />
                                  )}
                                  <Button tone="critical" onClick={() => removeField(field.id)}>Remove Field</Button>
                              </>
                          );
                      })()}
                   </BlockStack>
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
