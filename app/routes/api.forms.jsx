import { authenticate } from "../shopify.server";
import db from "../db.server";

// CORS Headers for storefront access
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const formId = url.searchParams.get("id");

  if (!formId) {
    return Response.json({ error: "Missing form ID" }, { headers: corsHeaders, status: 400 });
  }

  const form = await db.form.findUnique({
    where: { id: parseInt(formId) },
  });

  if (!form) {
    return Response.json({ error: "Form not found" }, { headers: corsHeaders, status: 404 });
  }

  return Response.json({ 
     id: form.id, 
     title: form.title, 
     fields: JSON.parse(form.fields) 
  }, { headers: corsHeaders });
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await request.json();
    const { formId, data } = body;

    if (!formId || !data) {
       return Response.json({ error: "Invalid data" }, { headers: corsHeaders, status: 400 });
    }

    await db.formSubmission.create({
      data: {
        formId: parseInt(formId),
        data: JSON.stringify(data),
      }
    });

    return Response.json({ success: true }, { headers: corsHeaders });
  } catch (error) {
    console.error("Form Submission Error:", error);
    return Response.json({ error: "Server Error" }, { headers: corsHeaders, status: 500 });
  }
};
