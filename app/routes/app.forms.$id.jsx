import { useLoaderData, useSubmit, useNavigation, Form as RemixForm, redirect, useRouteError, useActionData, useNavigate } from "react-router";
import { Page, Layout, Card, TextField, Button, BlockStack, Box, Text, Select, Checkbox, InlineStack, Banner, Divider, Badge, Icon, Tooltip, IndexTable, EmptyState, ColorPicker, RangeSlider, Collapsible, ButtonGroup, Tabs } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { DeleteIcon, DuplicateIcon, ClipboardIcon, ChevronDownIcon, ChevronUpIcon } from "@shopify/polaris-icons";
import { useState, useEffect, useCallback } from "react";
import { authenticate } from "../shopify.server";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import db from "../db.server";

// Helper to convert HSB to Hex (Polaris ColorPicker uses HSB)
function hsbToHex({ hue, saturation, brightness }) {
  const chroma = (brightness * saturation);
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = brightness - chroma;
  let r = 0, g = 0, b = 0;
  if (0 <= hue && hue < 60) { r = chroma; g = x; b = 0; }
  else if (60 <= hue && hue < 120) { r = x; g = chroma; b = 0; }
  else if (120 <= hue && hue < 180) { r = 0; g = chroma; b = x; }
  else if (180 <= hue && hue < 240) { r = 0; g = x; b = chroma; }
  else if (240 <= hue && hue < 300) { r = x; g = 0; b = chroma; }
  else if (300 <= hue && hue < 360) { r = chroma; g = 0; b = x; }

  const toHex = (n) => {
    const hex = Math.round((n + m) * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Helper: Hex to HSB (for initializing ColorPicker) - Simplified approximation or use a library
function hexToHsb(hex) {
  // Basic implementation for brevity, relying on user interaction to set precise colors
  // In a real app, use a robust library like 'tinycolor2' or 'colord'
  return { hue: 0, saturation: 0, brightness: 1 }; // Default dummy
}

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  if (params.id === "new") {
    const existingCount = await db.form.count({
      where: { shop: session.shop },
    });
    if (existingCount > 0) {
      const existingForm = await db.form.findFirst({
        where: { shop: session.shop },
      });
      return redirect(`/app/forms/${existingForm.id}`);
    }
    return { form: null };
  }

  const form = await db.form.findUnique({
    where: { id: parseInt(params.id) },
    include: {
      submissions: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!form || form.shop !== session.shop) {
    return redirect("/app/forms");
  }

  return { form };
};

export const action = async ({ request, params }) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const title = formData.get("title");
  const fields = formData.get("fields");
  const settings = formData.get("settings");
  const intent = formData.get("intent");
  const submissionId = formData.get("submissionId");

  try {
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
      // Fallback for name if "First Name" not found
      const nameKey = keys.find(k => k.toLowerCase() === "name" || k.toLowerCase().includes("name"));

      const email = emailKey ? data[emailKey] : null;
      const firstName = firstNameKey ? data[firstNameKey] : (nameKey ? data[nameKey] : "");
      const lastName = lastNameKey ? data[lastNameKey] : "";

      if (!email) {
        return { status: "error", message: "Could not find an email address in the submission data." };
      }

      // Create Customer in Shopify
      const response = await admin.graphql(
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

      const responseJson = await response.json();
      const userErrors = responseJson.data?.customerCreate?.userErrors;

      if (userErrors && userErrors.length > 0) {
        // Check if error is "Customer already exists" ("taken")
        if (userErrors[0].message.includes("taken")) {
          // Fetch existing customer ID and Tags
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
                return { status: "error", message: "Failed to update existing customer tags: " + updateJson.data.customerUpdate.userErrors[0].message };
              }
            }
            // Proceed to approve (fall through)
          } else {
            return { status: "error", message: "Email taken but could not find existing customer in Shopify." };
          }
        } else {
          return { status: "error", message: "Shopify Error: " + userErrors[0].message };
        }
      }

      await db.formSubmission.update({
        where: { id: parseInt(submissionId) },
        data: { status: "APPROVED" }
      });

      return { status: "success", message: "Submission approved and customer created." };
    }

    if (params.id === "new") {
      const existingCount = await db.form.count({
        where: { shop: session.shop },
      });

      if (existingCount > 0) {
        return { status: "error", message: "Form limit reached (Max 1)." };
      }

      const form = await db.form.create({
        data: {
          title: title || "Untitled Form",
          fields: fields || "[]",
          settings: settings || "{}",
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
          settings,
        },
      });
      return { status: "success" };
    }
  } catch (error) {
    console.error("Form Save Error:", error);
    return { status: "error", message: "Server error: " + error.message };
  }
};

// Sortable Field Component
function SortableField({ field, isActive, onClick, styleSettings }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: field.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    width: field.width === '50' ? '50%' : '100%',
    padding: '0 10px',
    marginBottom: '15px',
    cursor: 'grab',
  };

  const labelStyle = {
    display: 'block',
    marginBottom: '5px',
    fontWeight: '500',
    color: styleSettings?.labelColor || '#000',
    pointerEvents: 'none'
  };

  const inputStyle = {
    width: '100%',
    padding: `${styleSettings?.fieldPadding || 8}px`,
    border: `1px solid ${styleSettings?.borderColor || '#ddd'}`,
    borderRadius: `${styleSettings?.borderRadius || 4}px`,
    pointerEvents: 'none',
    color: styleSettings?.placeholderColor ? '#000' : 'inherit'
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
    >
      <div style={{
        border: isActive ? '2px solid #5c6ac4' : '1px dashed #bbb',
        padding: '10px',
        borderRadius: '4px',
        transition: 'border 0.2s',
        background: isActive ? 'rgba(92, 106, 196, 0.05)' : '#fff',
        position: 'relative'
      }}>
        <div style={{
          position: 'absolute',
          top: '-8px',
          right: '10px',
          background: '#eee',
          padding: '2px 6px',
          borderRadius: '4px',
          fontSize: '10px',
          color: '#666',
          textTransform: 'uppercase',
          fontWeight: 'bold',
          border: '1px solid #ddd'
        }}>
          {field.type}
        </div>

        {field.type === 'header' ? (
          <h3 style={{ margin: '15px 0 5px', borderBottom: '1px solid #ccc', paddingBottom: '5px' }}>{field.label}</h3>
        ) : (
          <>
            <label style={labelStyle}>
              {field.label} {field.required && <span style={{ color: styleSettings?.requiredColor || 'red' }}>*</span>}
            </label>
            {field.type === 'textarea' ? (
              <textarea
                disabled
                placeholder={field.placeholder}
                style={{ ...inputStyle, minHeight: '80px' }}
              />
            ) : field.type === 'select' ? (
              <select disabled style={inputStyle}>
                <option>Select...</option>
                {field.options?.map(opt => <option key={opt}>{opt}</option>)}
              </select>
                ) : field.type === 'radio' ? (
                  <div style={{ pointerEvents: 'none' }}>
                    {field.options?.length > 0 ? field.options.map((opt, i) => (
                      <div key={i} style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input type="radio" disabled />
                        <span style={{ color: styleSettings?.labelColor || '#000' }}>{opt}</span>
                      </div>
                    )) : <Text tone="subdued">No options defined</Text>}
                  </div>
            ) : field.type === 'checkbox' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', pointerEvents: 'none' }}>
                <input type="checkbox" disabled />
                <span style={{ color: styleSettings?.labelColor }}>{field.placeholder || "Checkbox text"}</span>
              </div>
                    ) : field.type === 'file' ? (
                      <input
                        type="file"
                        disabled
                        style={{ ...inputStyle, padding: '4px' }}
                      />
                    ) : field.type === 'date' ? (
                      <input
                        type="date"
                        disabled
                        style={{ ...inputStyle }}
                      />
            ) : (
              <input
                type={field.type}
                disabled
                placeholder={field.placeholder}
                style={{ ...inputStyle }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function FormEditor() {
  const loaderData = useLoaderData();
  const form = loaderData?.form;
  const actionData = useActionData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const isSaving = navigation.state === "submitting";

  const [title, setTitle] = useState(form?.title || "Contact Us");
  const [fields, setFields] = useState(form ? JSON.parse(form.fields) : []);

  const defaultSettings = {
    submitText: "Submit",
    subtitle: "",
    successMessage: "Thank you for contacting us!",
    labelColor: "#000000",
    borderColor: "#cccccc",
    placeholderColor: "#999999",
    borderRadius: 4,
    fieldPadding: 8,
    requiredColor: "#ff0000",
    submitColor: "#000000",
    submitTextColor: "#ffffff",
    submitHoverColor: "#333333",
    submitActiveColor: "#555555"
  };

  const [settings, setSettings] = useState(form?.settings ? { ...defaultSettings, ...JSON.parse(form.settings) } : defaultSettings);
  const [showStyleSettings, setShowStyleSettings] = useState(false);

  useEffect(() => {
    if (form) {
      setTitle(form.title);
      setFields(JSON.parse(form.fields));
      setSettings(form.settings ? { ...defaultSettings, ...JSON.parse(form.settings) } : defaultSettings);
    }
  }, [form]);

  const [activeField, setActiveField] = useState(null);
  const [selectedTab, setSelectedTab] = useState(0);

  const tabs = [
    { id: 'all', content: 'All' },
    { id: 'pending', content: 'Pending' },
    { id: 'approved', content: 'Approved' },
    { id: 'rejected', content: 'Rejected' },
  ];

  const filteredSubmissions = form?.submissions?.filter((sub) => {
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
  }) || [];


  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (active.id !== over.id) {
      setFields((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const fieldTypes = [
    { label: "Single Line Text", value: "text" },
    { label: "Paragraph Text", value: "textarea" },
    { label: "Email", value: "email" },
    { label: "Number", value: "number" },
    { label: "Date / Birthday", value: "date" },
    { label: "Dropdown", value: "select" },
    { label: "Radio Buttons", value: "radio" },
    { label: "Checkbox", value: "checkbox" },
    { label: "File Upload", value: "file" },
    { label: "Section Header", value: "header" },
  ];

  const addField = (type) => {
    const newField = {
      id: Date.now().toString(),
      type,
      label: type === "header" ? "New Section" : "New Field",
      required: false,
      width: "100", // 50 or 100
      placeholder: "",
      options: [],
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
    formData.append("settings", JSON.stringify(settings));
    submit(formData, { method: "post" });
  };

  useEffect(() => {
    if (actionData?.status === "success") {
      shopify.toast.show("Form saved successfully");
    } else if (actionData?.status === "error") {
      shopify.toast.show(actionData.message || "Failed to save form", { isError: true });
    }
  }, [actionData]);

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    shopify.toast.show("Copied to clipboard");
  };

  return (
    <Page>
      <TitleBar title={form ? "Edit Form" : "Create New Form"}>
        <button variant="primary" onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save"}
        </button>
        {form && (
          <button onClick={() => navigate(`/app/forms/${form.id}/submissions`)}>View Submissions</button>
        )}
      </TitleBar>
      <Layout>
        {actionData?.status === "error" && (
          <Layout.Section>
            <Banner tone="critical">
              <p>{actionData.message}</p>
            </Banner>
          </Layout.Section>
        )}

        {form && (
          <Layout.Section>
            <Card padding="400">
              <BlockStack gap="200">
                <Text variant="headingSm" as="h6">Form Integration</Text>
                <Text variant="bodySm" tone="subdued">Copy this ID and paste it into the "Custom Form" block settings in your Theme Editor.</Text>
                <InlineStack gap="200" align="start" blockAlign="center">
                  <Box background="bg-surface-secondary" padding="200" borderRadius="200" width="100%">
                    <Text variant="bodyMd" as="span" fontFamily="monospace" fontWeight="bold">
                      {form.id}
                    </Text>
                  </Box>
                  <Button icon={ClipboardIcon} onClick={() => copyToClipboard(form.id)} accessibilityLabel="Copy ID" />
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Left: Form Preview */}
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Form Settings</Text>
                <TextField label="Internal Form Title" value={title} onChange={setTitle} autoComplete="off" helpText="Only visible in the app admin." />
                <Divider />
                <TextField label="Page Title (Frontend)" value={settings.title || title} onChange={(val) => setSettings({ ...settings, title: val })} autoComplete="off" />
                <TextField label="Subtitle / Description" value={settings.subtitle} onChange={(val) => setSettings({ ...settings, subtitle: val })} autoComplete="off" multiline={3} />
                <InlineStack gap="400">
                  <div style={{ flex: 1 }}>
                    <TextField label="Submit Button Text" value={settings.submitText} onChange={(val) => setSettings({ ...settings, submitText: val })} autoComplete="off" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField label="Success Message" value={settings.successMessage} onChange={(val) => setSettings({ ...settings, successMessage: val })} autoComplete="off" />
                  </div>
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h2">Style Customization</Text>
                  <Button
                    variant="plain"
                    onClick={() => setShowStyleSettings(!showStyleSettings)}
                    icon={showStyleSettings ? ChevronUpIcon : ChevronDownIcon}
                  >
                    {showStyleSettings ? "Hide" : "Show"}
                  </Button>
                </InlineStack>

                <Collapsible open={showStyleSettings} id="style-settings-collapsible">
                  <BlockStack gap="400">
                    <Divider />
                    <Text variant="headingSm" as="h5">Colors</Text>
                    <InlineStack gap="400" wrap>
                      <div style={{ flex: 1, minWidth: '150px' }}>
                        <Text variant="bodySm">Label Color</Text>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                          <input type="color" value={settings.labelColor} onChange={(e) => setSettings({ ...settings, labelColor: e.target.value })} style={{ height: '30px', width: '30px', border: 'none', padding: 0, cursor: 'pointer' }} />
                          <TextField value={settings.labelColor} onChange={(val) => setSettings({ ...settings, labelColor: val })} autoComplete="off" />
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: '150px' }}>
                        <Text variant="bodySm">Border Color</Text>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                          <input type="color" value={settings.borderColor} onChange={(e) => setSettings({ ...settings, borderColor: e.target.value })} style={{ height: '30px', width: '30px', border: 'none', padding: 0, cursor: 'pointer' }} />
                          <TextField value={settings.borderColor} onChange={(val) => setSettings({ ...settings, borderColor: val })} autoComplete="off" />
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: '150px' }}>
                        <Text variant="bodySm">Placeholder Color</Text>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                          <input type="color" value={settings.placeholderColor} onChange={(e) => setSettings({ ...settings, placeholderColor: e.target.value })} style={{ height: '30px', width: '30px', border: 'none', padding: 0, cursor: 'pointer' }} />
                          <TextField value={settings.placeholderColor} onChange={(val) => setSettings({ ...settings, placeholderColor: val })} autoComplete="off" />
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: '150px' }}>
                        <Text variant="bodySm">Required Star (*)</Text>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                          <input type="color" value={settings.requiredColor} onChange={(e) => setSettings({ ...settings, requiredColor: e.target.value })} style={{ height: '30px', width: '30px', border: 'none', padding: 0, cursor: 'pointer' }} />
                          <TextField value={settings.requiredColor} onChange={(val) => setSettings({ ...settings, requiredColor: val })} autoComplete="off" />
                        </div>
                      </div>
                    </InlineStack>

                    <Divider />
                    <Text variant="headingSm" as="h5">Dimensions</Text>
                    <BlockStack gap="300">
                      <RangeSlider
                        label="Border Radius (px)"
                        value={settings.borderRadius}
                        onChange={(val) => setSettings({ ...settings, borderRadius: val })}
                        min={0} max={20}
                        output
                      />
                      <RangeSlider
                        label="Field Padding (px)"
                        value={settings.fieldPadding}
                        onChange={(val) => setSettings({ ...settings, fieldPadding: val })}
                        min={4} max={20}
                        output
                      />
                    </BlockStack>

                    <Divider />
                    <Text variant="headingSm" as="h5">Submit Button</Text>
                    <InlineStack gap="400" wrap>
                      <div style={{ flex: 1, minWidth: '150px' }}>
                        <Text variant="bodySm">Background Color</Text>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                          <input type="color" value={settings.submitColor} onChange={(e) => setSettings({ ...settings, submitColor: e.target.value })} style={{ height: '30px', width: '30px', border: 'none', padding: 0, cursor: 'pointer' }} />
                          <TextField value={settings.submitColor} onChange={(val) => setSettings({ ...settings, submitColor: val })} autoComplete="off" />
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: '150px' }}>
                        <Text variant="bodySm">Text Color</Text>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                          <input type="color" value={settings.submitTextColor} onChange={(e) => setSettings({ ...settings, submitTextColor: e.target.value })} style={{ height: '30px', width: '30px', border: 'none', padding: 0, cursor: 'pointer' }} />
                          <TextField value={settings.submitTextColor} onChange={(val) => setSettings({ ...settings, submitTextColor: val })} autoComplete="off" />
                        </div>
                      </div>
                    </InlineStack>
                    <InlineStack gap="400" wrap>
                      <div style={{ flex: 1, minWidth: '150px' }}>
                        <Text variant="bodySm">Hover Background</Text>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                          <input type="color" value={settings.submitHoverColor} onChange={(e) => setSettings({ ...settings, submitHoverColor: e.target.value })} style={{ height: '30px', width: '30px', border: 'none', padding: 0, cursor: 'pointer' }} />
                          <TextField value={settings.submitHoverColor} onChange={(val) => setSettings({ ...settings, submitHoverColor: val })} autoComplete="off" />
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: '150px' }}>
                        <Text variant="bodySm">Active Background</Text>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                          <input type="color" value={settings.submitActiveColor} onChange={(e) => setSettings({ ...settings, submitActiveColor: e.target.value })} style={{ height: '30px', width: '30px', border: 'none', padding: 0, cursor: 'pointer' }} />
                          <TextField value={settings.submitActiveColor} onChange={(val) => setSettings({ ...settings, submitActiveColor: val })} autoComplete="off" />
                        </div>
                      </div>
                    </InlineStack>

                  </BlockStack>
                </Collapsible>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h2">Form Preview</Text>
                  <Badge tone="info">Live Preview</Badge>
                </InlineStack>

                <Box padding="600" background="bg-surface-secondary" borderRadius="200" borderWidth="1" borderColor="border">
                  {/* Mock Form PREVIEW */}
                  <div style={{ maxWidth: '100%', margin: '0 auto' }}>
                    {settings.title && <h2 style={{ fontSize: '24px', marginBottom: '10px' }}>{settings.title}</h2>}
                    {settings.subtitle && <p style={{ marginBottom: '20px', color: '#666' }}>{settings.subtitle}</p>}

                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        items={fields}
                        strategy={rectSortingStrategy}
                      >
                        <div style={{ display: 'flex', flexWrap: 'wrap', margin: '0 -10px' }}>
                          {fields.map((field) => (
                            <SortableField
                              key={field.id}
                              field={field}
                              isActive={activeField === field.id}
                              onClick={(e) => { e.stopPropagation(); setActiveField(field.id); }}
                              styleSettings={settings}
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>


                    {fields.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '40px', color: '#999', border: '2px dashed #ddd', borderRadius: '8px' }}>
                        Click "Add Field" from the right sidebar to start building.
                      </div>
                    )}

                    <div style={{ marginTop: '20px', padding: '0 10px' }}>
                      <button disabled style={{
                        background: settings.submitColor || '#000',
                        color: settings.submitTextColor || '#fff',
                        padding: '10px 25px', border: 'none', borderRadius: '4px', cursor: 'pointer', opacity: 0.7
                      }}>
                        {settings.submitText}
                      </button>
                    </div>
                  </div>
                </Box>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        {/* Right: Toolbox */}
        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <Text variant="headingSm" as="h5">Toolbox</Text>
                <InlineStack gap="200" wrap>
                  {fieldTypes.map(ft => (
                    <s-button
                      key={ft.value}
                      onClick={() => addField(ft.value)}
                      size="slim"
                      variant={ft.value === 'header' ? 'secondary' : 'primary'} // Visual distinction
                    >
                      {ft.label}
                    </s-button>
                  ))}
                </InlineStack>
              </BlockStack>
            </Card>

            {activeField && (
              <Card>
                <BlockStack gap="400">
                  {(() => {
                    const field = fields.find(f => f.id === activeField);
                    if (!field) return <Text tone="subdued">Field not found.</Text>;

                    return (
                      <>
                        <InlineStack align="space-between">
                          <Text variant="headingSm" as="h5">Edit: {field.label} </Text>
                          <Button icon={DeleteIcon} tone="critical" variant="plain" onClick={() => removeField(activeField)} />
                        </InlineStack>
                        <TextField
                          label="Label"
                          value={field.label}
                          onChange={(val) => updateField(field.id, 'label', val)}
                          autoComplete="off"
                        />

                        {field.type !== 'header' && field.type !== 'checkbox' && (
                          <TextField
                            label="Placeholder"
                            value={field.placeholder}
                            onChange={(val) => updateField(field.id, 'placeholder', val)}
                            autoComplete="off"
                          />
                        )}

                        {field.type !== 'header' && (
                          <Select
                            label="Width"
                            options={[
                              { label: 'Full Width (100%)', value: '100' },
                              { label: 'Half Width (50%)', value: '50' },
                            ]}
                            value={field.width || '100'}
                            onChange={(val) => updateField(field.id, 'width', val)}
                          />
                        )}

                        {field.type !== 'header' && (
                          <Checkbox
                            label="Required Field"
                            checked={field.required}
                            onChange={(val) => updateField(field.id, 'required', val)}
                          />
                        )}

                        {(field.type === 'select' || field.type === 'radio') && (
                          <TextField
                            label="Options (comma separated)"
                            value={field.options?.join(', ')}
                            onChange={(val) => updateField(field.id, 'options', val.split(',').map(s => s.trim()))}
                            autoComplete="off"
                            helpText="Example: Red, Blue, Green"
                          />
                        )}
                      </>
                    );
                  })()}
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>

      {
        form?.submissions && (
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">Form Submissions</Text>

                  <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
                    {/* Tabs content handling is done by filtering logic below */}
                  </Tabs>

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
                        {filteredSubmissions.map((sub, index) => {
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
                                      ) : (
                                        JSON.stringify(v)
                                      )
                                    ) : (
                                      v
                                    )}
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
                            <IndexTable.Cell>
                              {new Date(sub.createdAt).toLocaleString()}
                            </IndexTable.Cell>
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
                        );
                      })}
                    </IndexTable>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        )
      }
    </Page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <Page title="Error">
      <Layout>
        <Layout.Section>
          <Banner tone="critical">
            <p>An error occurred: {error?.message || "Unknown error"}</p>
          </Banner>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
