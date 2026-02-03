import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // With in-memory session storage, Shopify manages scopes for the current
  // session internally. We log the current scopes for debugging but do not
  // persist them to an external database.
  const current = payload.current as string[];
  if (session) {
    console.log(`Updated scopes for ${shop}:`, current.join(","));
  }

  return new Response();
};
