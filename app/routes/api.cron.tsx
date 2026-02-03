import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { memoryStore } from "../memory.server";

const OUTBLOG_API_URL = "https://api.outblogai.com";

// This endpoint can be called by an external cron service (e.g., cron-job.org, Vercel cron, etc.)
// to sync blogs daily for all shops with configured API keys
// NOTE: With memory storage, this only works for shops that are currently in memory
export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Verify cron secret to prevent unauthorized access
  const url = new URL(request.url);
  const cronSecret = url.searchParams.get("secret");
  
  if (cronSecret !== process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  return Response.json({
    success: false,
    error: "Cron sync not available with memory storage. Please use manual sync in the app."
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  // Verify cron secret
  const formData = await request.formData();
  const cronSecret = formData.get("secret") as string;
  
  if (cronSecret !== process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  return Response.json({
    success: false,
    error: "Cron sync not available with memory storage. Please use manual sync in the app."
  });
};
