import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { memoryStore } from "../memory.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Clean up all app data for this shop so that reinstall starts from a clean state.
  // This removes:
  // - ShopSettings for the shop (API key, postAsDraft, lastSyncAt, etc.)
  // - All related OutblogPost records 
  //
  // Publishing logic and other routes will recreate ShopSettings as needed
  // when the app is reinstalled, so this won't break the publish flow.
  await memoryStore.deleteShopSettings(shop);

  return new Response();
};
