import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { databaseStore } from "../database.server";

// const OUTBLOG_API_URL = "http://localhost:8000"; // use this locally if needed
const OUTBLOG_API_URL = "https://api.outblogai.com";

interface BlogPost {
  id: string;
  slug: string;
  title: string;
  content: string | null;
  metaDescription: string | null;
  featuredImage: string | null;
  status: string;
  categories: string | null;
  tags: string | null;
  shopifyArticleId: string | null;
  createdAt: string;
}

interface LoaderData {
  shop: string;
  apiKey: string | null;
  postAsDraft: boolean;
  blogs: BlogPost[];
  totalBlogs: number;
  currentPage: number;
  totalPages: number;
  lastSyncAt: string | null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  
  // Get pagination params from URL
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const pageSize = 10;
  const skip = (page - 1) * pageSize;

  let shopSettings = await databaseStore.getShopSettings(shop);

  if (!shopSettings) {
    shopSettings = await databaseStore.createShopSettings(shop);
  }

  const { posts: blogs, total: totalBlogs } = await databaseStore.getBlogPosts(shop, skip, pageSize);

  return {
    shop,
    apiKey: shopSettings.apiKey,
    postAsDraft: shopSettings.postAsDraft,
    blogs: blogs.map((b) => ({
      ...b,
      createdAt: b.createdAt.toISOString(),
    })),
    totalBlogs,
    currentPage: page,
    totalPages: Math.ceil(totalBlogs / pageSize),
    lastSyncAt: shopSettings.lastSyncAt?.toISOString() || null,
  } as LoaderData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("_action") as string;

  if (actionType === "saveApiKey") {
    const apiKey = formData.get("apiKey") as string;
    const postAsDraft = formData.get("postAsDraft") === "true";

    // Validate API key with Outblog backend
    try {
      const validateResponse = await fetch(`${OUTBLOG_API_URL}/blogs/validate-api-key`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
      });

      if (!validateResponse.ok) {
        console.log(validateResponse);
        return { success: false, error: "Failed to validate API key" };
      }

      const validateData = await validateResponse.json();
      if (!validateData.valid) {
        return { success: false, error: "Invalid API key" };
      }

      // Save API key
      await databaseStore.upsertShopSettings(shop, { apiKey, postAsDraft });

      return { success: true, message: "API key saved successfully" };
    } catch (error) {
      return { success: false, error: "Failed to validate API key" };
    }
  }

  if (actionType === "fetchBlogs") {
    const shopSettings = await databaseStore.getShopSettings(shop);

    if (!shopSettings?.apiKey) {
      return { success: false, error: "API key not configured" };
    }

    try {
      const response = await fetch(`${OUTBLOG_API_URL}/blogs/posts/wp`, {
        headers: {
          "x-api-key": shopSettings.apiKey,
        },
      });

      if (!response.ok) {
        // Handle specific HTTP errors
        if (response.status === 401) {
          return { success: false, error: "Invalid API key. Please check your Outblog API configuration." };
        } else if (response.status === 403) {
          return { success: false, error: "API access forbidden. Please check your subscription." };
        } else if (response.status === 429) {
          return { success: false, error: "Rate limit exceeded. Please try again in a few minutes." };
        } else if (response.status >= 500) {
          return { success: false, error: "Outblog server error. Please try again later." };
        } else {
          return { success: false, error: `Failed to fetch blogs (HTTP ${response.status})` };
        }
      }

      const data = await response.json();
      const posts = data.data?.posts || [];

      // Store blogs in database
      for (const post of posts) {
        const slug = post.slug || post.title?.toLowerCase().replace(/\s+/g, "-") || "untitled";
        
        await databaseStore.upsertBlogPost(shop, {
          externalId: post.id,
          slug,
          title: post.title || "Untitled",
          content: post.content,
          metaDescription: post.blog_meta_data?.meta_description,
          featuredImage: post.featured_image,
          categories: JSON.stringify(post.blog_meta_data?.categories || []),
          tags: JSON.stringify(post.blog_meta_data?.tags || []),
        });
      }

      // Update last sync time
      await databaseStore.upsertShopSettings(shop, { lastSyncAt: new Date() });

      return { success: true, message: `Fetched ${posts.length} blogs` };
    } catch (error) {
      console.error("Error fetching blogs:", error);
      
      // Handle specific error types
      if (error instanceof Error) {
        // Network errors
        if (error.message.includes('fetch') || error.message.includes('network') || error.message.includes('ENOTFOUND')) {
          return { 
            success: false, 
            error: "Network error. Please check your connection and try again." 
          };
        }
        
        // Timeout errors
        if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
          return { 
            success: false, 
            error: "Request timed out. Please try again." 
          };
        }
        
        // Database errors
        if (error.message.includes('database') || error.message.includes('prisma')) {
          return { 
            success: false, 
            error: "Database error. Please try again in a moment." 
          };
        }
      }
      
      return { 
        success: false, 
        error: "Failed to fetch blogs from Outblog. Please try again." 
      };
    }
  }

  if (actionType === "checkLiveStatus") {
    // Verify that Shopify articles referenced by our blogs still exist and are published
    const shopSettings = await databaseStore.getShopSettings(shop);

    if (!shopSettings) {
      return { success: false, error: "Shop settings not found" };
    }

    const blogsWithArticleId = shopSettings.blogs.filter((b) => b.shopifyArticleId);

    if (blogsWithArticleId.length === 0) {
      return { success: true, message: "No published blogs to check" };
    }

    try {
      const missingIds: string[] = [];

      // Shopify Admin GraphQL nodes query can take up to 250 IDs at a time; batch if needed
      const batchSize = 50;
      for (let i = 0; i < blogsWithArticleId.length; i += batchSize) {
        const batch = blogsWithArticleId.slice(i, i + batchSize);
        const ids = batch.map((b) => b.shopifyArticleId as string);

        const statusResponse = await admin.graphql(
          `#graphql
          query CheckArticlesStatus($ids: [ID!]!) {
            nodes(ids: $ids) {
              __typename
              ... on Article {
                id
                publishedAt
              }
            }
          }`,
          {
            variables: { ids },
          }
        );

        const statusData = await statusResponse.json() as any;

        if (statusData.errors && statusData.errors.length > 0) {
          console.error("GraphQL errors while checking status:", statusData.errors);
          return { success: false, error: statusData.errors[0].message };
        }

        const nodes = statusData.data?.nodes || [];
        const existingIds = new Set<string>();

        nodes.forEach((node: any) => {
          if (node && node.__typename === "Article" && node.id) {
            // Treat any existing Article (regardless of publishedAt) as still present
            existingIds.add(node.id);
          }
        });

        for (const blog of batch) {
          const articleId = blog.shopifyArticleId as string;
          if (!existingIds.has(articleId)) {
            missingIds.push(blog.id);
          }
        }
      }

      if (missingIds.length > 0) {
        await databaseStore.updateManyBlogPosts(shop, missingIds, {
          shopifyArticleId: undefined,
          status: "draft",
        });
      }

      const message = missingIds.length
        ? `Live status checked: ${missingIds.length} blog(s) are no longer published in Shopify and were marked as not published.`
        : "Live status checked: all published blogs still exist in Shopify.";

      return { success: true, message };
    } catch (error) {
      console.error("Error checking live status:", error);
      return { success: false, error: "Failed to check live status" };
    }
  }

  if (actionType === "publishToShopify") {
    const blogId = formData.get("blogId") as string;
    
    const shopSettings = await databaseStore.getShopSettings(shop);

    if (!shopSettings) {
      return { success: false, error: "Shop settings not found" };
    }

    const blogPost = await databaseStore.findBlogPost(shop, blogId);

    if (!blogPost) {
      return { success: false, error: "Blog post not found" };
    }

    try {
      // First, get or create the "outblog" blog
      const blogsResponse = await admin.graphql(
        `#graphql
        query getBlogs {
          blogs(first: 50) {
            edges {
              node {
                id
                title
                handle
              }
            }
          }
        }`
      );

      const blogsData = await blogsResponse.json();
      let outblogBlog = blogsData.data?.blogs?.edges?.find(
        (edge: any) => edge.node.handle === "outblog"
      );

      if (!outblogBlog) {
        // Create the outblog blog
        const createBlogResponse = await admin.graphql(
          `#graphql
          mutation createBlog($blog: BlogCreateInput!) {
            blogCreate(blog: $blog) {
              blog {
                id
                title
                handle
              }
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: {
              blog: {
                title: "Outblog",
                handle: "outblog",
              },
            },
          }
        );

        const createBlogData = await createBlogResponse.json();
        if (createBlogData.data?.blogCreate?.userErrors?.length > 0) {
          return { success: false, error: createBlogData.data.blogCreate.userErrors[0].message };
        }
        outblogBlog = { node: createBlogData.data?.blogCreate?.blog };
      }

      // Strip front matter from content
      let cleanContent = blogPost.content || "";
      cleanContent = cleanContent.replace(/^---\s[\s\S]*?---\s*/m, "");
      
      // Ensure content is not empty and is properly formatted
      if (!cleanContent || cleanContent.trim().length === 0) {
        cleanContent = `<p>${blogPost.title || 'Untitled'}</p>`;
      }
      
      // Convert markdown to basic HTML if needed
      if (
        cleanContent.includes('#') ||
        cleanContent.includes('*') ||
        cleanContent.includes('[') // links/images
      ) {
        cleanContent = cleanContent
          // Headings (including h4)
          .replace(/^#### (.*$)/gim, '<h4>$1</h4>')
          .replace(/^### (.*$)/gim, '<h3>$1</h3>')
          .replace(/^## (.*$)/gim, '<h2>$1</h2>')
          .replace(/^# (.*$)/gim, '<h1>$1</h1>')
          // Bold / italic
          .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/gim, '<em>$1</em>')
          // Bullet lists (handle before italic conversion)
          .replace(/^\* (.+)$/gim, '<li>$1</li>')
          .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
          // Images: ![alt](url)
          .replace(/!\[([^\]]*)\]\(([^)]+)\)/gim, '<img src="$2" alt="$1" />')
          // Links: [text](url)
          .replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
          // Paragraphs / line breaks (but avoid wrapping lists)
          .replace(/\n\n/gim, '</p><p>')
          .replace(/\n/gim, '<br>');

        // Fix: Remove paragraph tags around lists
        cleanContent = cleanContent.replace(/<p>(<ul>.*?<\/ul>)<\/p>/gs, '$1');
        
        // Fix: Handle horizontal rules (---) 
        cleanContent = cleanContent.replace(/^---$/gim, '<hr>');
        
        if (!cleanContent.startsWith('<')) {
          cleanContent = `<p>${cleanContent}</p>`;
        }
      }

      // Validate and prepare article handle
      let articleHandle = blogPost.slug;
      if (!articleHandle) {
        articleHandle = blogPost.title?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
      }

      // Prepare article image from Outblog data (featuredImage)
      let articleImage: { altText: string; url: string } | null = null;
      if (blogPost.featuredImage) {
        try {
          const imageUrl = new URL(blogPost.featuredImage);
          if (imageUrl.protocol === "http:" || imageUrl.protocol === "https:") {
            articleImage = {
              altText: blogPost.title?.substring(0, 125) || "Blog post image",
              url: blogPost.featuredImage,
            };
          }
        } catch (e) {
          // Ignore invalid image URLs and continue without image
        }
      }

      console.log("Creating article with:", {
        blogId: outblogBlog.node.id,
        title: blogPost.title,
        handle: articleHandle,
        isPublished: !shopSettings.postAsDraft,
        contentLength: cleanContent.length,
        session: session,
        blogId1: outblogBlog.node.id,
        title1: blogPost.title,
        content1: cleanContent,
        handle1: articleHandle,
        isPublished1: !shopSettings.postAsDraft,
        featuredImage: blogPost.featuredImage,
        articleImage,
      });

      // Create the article with proper author format
      console.log("print 1")
      const createArticleResponse = await admin.graphql(
        `#graphql
        mutation createArticle($article: ArticleCreateInput!) {
          articleCreate(article: $article) {
            article {
              id
              title
              handle
              author {
                name
              }
              body
              image {
                altText
                originalSrc
              }
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            article: {
              blogId: outblogBlog.node.id,
              title: blogPost.title,
              body: cleanContent,
              handle: articleHandle,
              isPublished: true,
              author: {
                name: "Outblog AI"
              },
              ...(articleImage && { image: articleImage }),
            },
          },
        }
      );      
      console.log("print 2")
      const createArticleData = await createArticleResponse.json() as any;
      console.log("Create article response:", JSON.stringify(createArticleData, null, 2));
      
      // Handle Shopify API errors
      if (createArticleData.data?.articleCreate?.userErrors?.length > 0) {
        const error = createArticleData.data.articleCreate.userErrors[0];
        console.error("Article creation error:", error);
        return { 
          success: false, 
          error: `Shopify API Error: ${error.field ? error.field + ': ' : ''}${error.message}` 
        };
      }
      
      // Handle GraphQL-level errors
      if (createArticleData.errors && createArticleData.errors.length > 0) {
        console.error("GraphQL errors:", createArticleData.errors);
        return { 
          success: false, 
          error: `GraphQL Error: ${createArticleData.errors[0].message}` 
        };
      }

      // Handle missing article data
      if (!createArticleData.data?.articleCreate?.article) {
        console.error("No article data returned:", createArticleData);
        return { 
          success: false, 
          error: "Shopify API returned no article data. Please try again." 
        };
      }

      const articleId = createArticleData.data?.articleCreate?.article?.id;

      // Update the blog post with Shopify article ID
      await databaseStore.updateBlogPost(shop, blogId, {
        shopifyArticleId: articleId,
        status: shopSettings.postAsDraft ? "draft" : "published",
      });

      return { success: true, message: "Blog published to Shopify" };
    } catch (error) {
      console.error("Error publishing to Shopify:", error);
      
      // Handle specific error types
      if (error instanceof Error) {
        // Token/session errors
        if (error.message.includes('Authentication') || error.message.includes('Unauthorized') || error.message.includes('token')) {
          return { 
            success: false, 
            error: "Authentication error. Please refresh the page and try again." 
          };
        }
        
        // Network errors
        if (error.message.includes('fetch') || error.message.includes('network') || error.message.includes('ENOTFOUND')) {
          return { 
            success: false, 
            error: "Network error. Please check your connection and try again." 
          };
        }
        
        // Timeout errors
        if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
          return { 
            success: false, 
            error: "Request timed out. Please try again." 
          };
        }
        
        // Database errors
        if (error.message.includes('database') || error.message.includes('prisma')) {
          return { 
            success: false, 
            error: "Database error. Please try again in a moment." 
          };
        }
      }
      
      return { 
        success: false, 
        error: "Blog publish failed. Please try again. If the issue persists, contact support." 
      };
    }
  }

  if (actionType === "publishAllToShopify") {
    const shopSettings = await databaseStore.getShopSettings(shop);

    if (!shopSettings) {
      return { success: false, error: "Shop settings not found" };
    }

    try {
      // Get or create the "outblog" blog
      const blogsResponse = await admin.graphql(
        `#graphql
        query getBlogs {
          blogs(first: 50) {
            edges {
              node {
                id
                title
                handle
              }
            }
          }
        }`
      );

      const blogsData = await blogsResponse.json();
      let outblogBlog = blogsData.data?.blogs?.edges?.find(
        (edge: any) => edge.node.handle === "outblog"
      );

      if (!outblogBlog) {
        const createBlogResponse = await admin.graphql(
          `#graphql
          mutation createBlog($blog: BlogCreateInput!) {
            blogCreate(blog: $blog) {
              blog {
                id
                title
                handle
              }
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: {
              blog: {
                title: "Outblog",
              },
            },
          }
        );

        const createBlogData = await createBlogResponse.json();
        outblogBlog = { node: createBlogData.data?.blogCreate?.blog };
      }

      let publishedCount = 0;
      const unpublishedBlogs = shopSettings.blogs.filter((blog) => !blog.shopifyArticleId);
      for (const blogPost of unpublishedBlogs) {
        let cleanContent = blogPost.content || "";
        cleanContent = cleanContent.replace(/^---\s[\s\S]*?---\s*/m, "");

        const createArticleResponse = await admin.graphql(
          `#graphql
          mutation createArticle($article: ArticleCreateInput!) {
            articleCreate(article: $article) {
              article {
                id
                title
                handle
              }
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: {
              article: {
                blogId: outblogBlog.node.id,
                title: blogPost.title,
                body: cleanContent,
                handle: blogPost.slug,
                isPublished: !shopSettings.postAsDraft,
              },
            },
          }
        );

        const createArticleData = await createArticleResponse.json();
        if (!createArticleData.data?.articleCreate?.userErrors?.length) {
          const articleId = createArticleData.data?.articleCreate?.article?.id;
          await databaseStore.updateBlogPost(shop, blogPost.id, {
            shopifyArticleId: articleId,
            status: shopSettings.postAsDraft ? "draft" : "published",
          });
          publishedCount++;
        }
      }

      return { success: true, message: `Published ${publishedCount} blogs to Shopify` };
    } catch (error) {
      console.error("Error publishing all to Shopify:", error);
      
      // Handle specific error types
      if (error instanceof Error) {
        // Token/session errors
        if (error.message.includes('Authentication') || error.message.includes('Unauthorized') || error.message.includes('token')) {
          return { 
            success: false, 
            error: "Authentication error. Please refresh the page and try again." 
          };
        }
        
        // Network errors
        if (error.message.includes('fetch') || error.message.includes('network') || error.message.includes('ENOTFOUND')) {
          return { 
            success: false, 
            error: "Network error. Please check your connection and try again." 
          };
        }
        
        // Timeout errors
        if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
          return { 
            success: false, 
            error: "Request timed out. Please try again." 
          };
        }
        
        // Database errors
        if (error.message.includes('database') || error.message.includes('prisma')) {
          return { 
            success: false, 
            error: "Database error. Please try again in a moment." 
          };
        }
      }
      
      return { 
        success: false, 
        error: "Bulk publish failed. Please try again. If the issue persists, contact support." 
      };
    }
  }

  return { success: false, error: "Unknown action" };
};

export default function Index() {
  const loaderData = useLoaderData<LoaderData>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  const [apiKey, setApiKey] = useState(loaderData.apiKey || "");
  const [postAsDraft, setPostAsDraft] = useState(loaderData.postAsDraft);

  const isLoading = fetcher.state !== "idle";
  const actionData = fetcher.data;
  const { currentPage, totalPages } = loaderData;

  useEffect(() => {
    if (actionData?.success && actionData?.message) {
      try {
        shopify.toast.show(actionData.message);
      } catch (error) {
        console.error("Error showing success toast:", error);
        // Fallback: just log the message
        console.log("Success:", actionData.message);
      }
    } else if (actionData?.error) {
      try {
        shopify.toast.show(actionData.error, { isError: true });
      } catch (error) {
        console.error("Error showing error toast:", error);
        // Fallback: use alert for critical errors
        if (actionData.error.includes('Authentication') || actionData.error.includes('Network')) {
          alert(actionData.error);
        }
      }
    }
  }, [actionData, shopify]);

  const handleSaveApiKey = () => {
    fetcher.submit(
      { _action: "saveApiKey", apiKey, postAsDraft: postAsDraft.toString() },
      { method: "POST" }
    );
  };

  const handleFetchBlogs = () => {
    fetcher.submit({ _action: "fetchBlogs" }, { method: "POST" });
  };

  const handlePublishToShopify = (blogId: string) => {
    try {
      fetcher.submit({ _action: "publishToShopify", blogId }, { method: "POST" });
    } catch (error) {
      console.error("Error submitting publish request:", error);
      shopify.toast.show("Failed to publish blog. Please try again.", { isError: true });
    }
  };

  const handlePublishAllToShopify = () => {
    try {
      fetcher.submit({ _action: "publishAllToShopify" }, { method: "POST" });
    } catch (error) {
      console.error("Error submitting bulk publish request:", error);
      shopify.toast.show("Failed to publish blogs. Please try again.", { isError: true });
    }
  };

  const handleCheckLiveStatus = () => {
    try {
      fetcher.submit({ _action: "checkLiveStatus" }, { method: "POST" });
    } catch (error) {
      console.error("Error submitting status check request:", error);
      shopify.toast.show("Failed to check status. Please try again.", { isError: true });
    }
  };

  const handlePageChange = (page: number) => {
    navigate(`?page=${page}`);
  };

  // Show setup screen if no API key
  if (!loaderData.apiKey) {
    return (
      <s-page heading="Outblog Setup">
        <s-section heading="Connect to Outblog">
          <s-paragraph>
            Enter your API key to connect your Shopify store with Outblog AI.
            This will allow you to automatically sync and publish blog posts.
          </s-paragraph>
          
          <s-stack direction="block" gap="base">
            <s-box padding="base">
              <s-stack direction="block" gap="base">
                <s-text-field
                  label="API Key"
                  value={apiKey}
                  onChange={(e: any) => setApiKey(e.target.value)}
                  placeholder="Enter your Outblog API key"
                  helpText="Get your API key from the Outblog dashboard"
                />
                
                <s-paragraph>
                  <s-text>Don't have an API key? </s-text>
                  <s-link href="https://www.outblogai.com/dashboard" target="_blank">
                    Get one from outblogai.com/dashboard
                  </s-link>
                </s-paragraph>

                <s-checkbox
                  checked={postAsDraft}
                  onChange={(e: any) => setPostAsDraft(e.target.checked)}
                >
                  Save posts as draft (uncheck to publish directly)
                </s-checkbox>

                <s-button
                  onClick={handleSaveApiKey}
                  variant="primary"
                  {...(isLoading ? { loading: true } : {})}
                >
                  Save & Connect
                </s-button>
              </s-stack>
            </s-box>
          </s-stack>
        </s-section>

        <s-section slot="aside" heading="About Outblog">
          <s-paragraph>
            Outblog AI automatically generates SEO-optimized blog posts for your store.
            Connect your API key to start syncing content.
          </s-paragraph>
          <s-unordered-list>
            <s-list-item>Automatic blog generation</s-list-item>
            <s-list-item>SEO optimized content</s-list-item>
            <s-list-item>Daily sync with your store</s-list-item>
          </s-unordered-list>
        </s-section>
      </s-page>
    );
  }

  try {
    return (
      <s-page heading="Outblog Dashboard">
        <s-button slot="primary-action" onClick={handleFetchBlogs} {...(isLoading ? { loading: true } : {})}>
          Fetch Blogs
        </s-button>

        <s-section heading="Blog Posts">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base">
            <s-paragraph>
              <s-text fontWeight="bold">Total blogs: </s-text>
              <s-text>{loaderData.totalBlogs}</s-text>
            </s-paragraph>
            {loaderData.lastSyncAt && (
              <s-paragraph>
                <s-text fontWeight="bold">Last sync: </s-text>
                <s-text>{new Date(loaderData.lastSyncAt).toLocaleString()}</s-text>
              </s-paragraph>
            )}
          </s-stack>

          {loaderData.blogs.length > 0 ? (
            <>
              <s-stack direction="inline" gap="base">
                <s-button onClick={handlePublishAllToShopify} variant="secondary" {...(isLoading ? { loading: true } : {})}>
                  Publish All to Shopify
                </s-button>
                <s-button onClick={handleCheckLiveStatus} variant="tertiary" {...(isLoading ? { loading: true } : {})}>
                  Check Live Status
                </s-button>
              </s-stack>

              <s-box borderWidth="base" borderRadius="base" overflow="hidden">
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ backgroundColor: "var(--p-color-bg-surface-secondary)" }}>
                      <th style={{ padding: "12px", textAlign: "left", borderBottom: "1px solid var(--p-color-border)" }}>Title</th>
                      <th style={{ padding: "12px", textAlign: "left", borderBottom: "1px solid var(--p-color-border)" }}>Image</th>
                      <th style={{ padding: "12px", textAlign: "left", borderBottom: "1px solid var(--p-color-border)" }}>Status</th>
                      <th style={{ padding: "12px", textAlign: "left", borderBottom: "1px solid var(--p-color-border)" }}>Created</th>
                      <th style={{ padding: "12px", textAlign: "left", borderBottom: "1px solid var(--p-color-border)" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loaderData.blogs.map((blog) => (
                      <tr key={blog.id} style={{ borderBottom: "1px solid var(--p-color-border)" }}>
                        <td style={{ padding: "12px" }}>
                          <s-text fontWeight="semibold">{blog.title}</s-text>
                          {blog.metaDescription && (
                            <s-text tone="neutral">
                              {blog.metaDescription.substring(0, 60)}...
                            </s-text>
                          )}
                        </td>
                        <td style={{ padding: "12px" }}>
                          {blog.featuredImage ? (
                            <img
                              src={blog.featuredImage}
                              alt={blog.title}
                              style={{ width: "60px", height: "40px", objectFit: "cover", borderRadius: "4px" }}
                            />
                          ) : (
                            <s-text tone="neutral">No image</s-text>
                          )}
                        </td>
                        <td style={{ padding: "12px" }}>
                          <s-badge tone={blog.shopifyArticleId ? "success" : "info"}>
                            {blog.shopifyArticleId ? "Published" : "Pending"}
                          </s-badge>
                        </td>
                        <td style={{ padding: "12px" }}>
                          <s-text variant="bodySm">
                            {new Date(blog.createdAt).toLocaleDateString()}
                          </s-text>
                        </td>
                        <td style={{ padding: "12px" }}>
                          {!blog.shopifyArticleId ? (
                            <s-button
                              onClick={() => handlePublishToShopify(blog.id)}
                              {...(isLoading ? { disabled: true } : {})}
                            >
                              Publish
                            </s-button>
                          ) : (
                            <s-stack direction="inline" gap="base">
                              {/* Live view on storefront using blog slug and outblog blog handle */}
                              {blog.slug && (
                                <s-button
                                  variant="tertiary"
                                  onClick={() => window.open(`https://${loaderData.shop}/blogs/outblog/${blog.slug}`, '_blank')}
                                >
                                  Live view
                                </s-button>
                              )}

                              {/* Editor view in Shopify admin using numeric article id */}
                              {blog.shopifyArticleId && (
                                <s-button
                                  variant="tertiary"
                                  onClick={() => window.open(`https://${loaderData.shop}/admin/articles/${blog.shopifyArticleId!.split('/').pop()}`, '_blank')}
                                >
                                  Editor view
                                </s-button>
                              )}
                            </s-stack>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </s-box>

              {totalPages > 1 && (
                <s-stack direction="inline" gap="base" align="center">
                  <s-button
                    variant="tertiary"
                    onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </s-button>
                  <s-text>
                    Page {currentPage} of {totalPages}
                  </s-text>
                  <s-button
                    variant="tertiary"
                    onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Next
                  </s-button>
                </s-stack>
              )}
            </>
          ) : (
            <s-box padding="loose" background="subdued" borderRadius="base">
              <s-stack direction="block" gap="base" align="center">
                <s-text>No blog posts found</s-text>
                <s-paragraph>
                  Click "Fetch Blogs" to sync your posts from Outblog, or create new posts at{" "}
                  <s-link href="https://www.outblogai.com/dashboard" target="_blank">
                    outblogai.com
                  </s-link>
                </s-paragraph>
              </s-stack>
            </s-box>
          )}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Settings">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="API Key"
            value={apiKey}
            onChange={(e: any) => setApiKey(e.target.value)}
            type="password"
          />
          
          <s-checkbox
            checked={postAsDraft}
            onChange={(e: any) => setPostAsDraft(e.target.checked)}
          >
            Save posts as draft
          </s-checkbox>

          <s-button onClick={handleSaveApiKey} {...(isLoading ? { loading: true } : {})}>
            Update Settings
          </s-button>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Quick Links">
        <s-unordered-list>
          <s-list-item>
            <s-link href="https://www.outblogai.com/dashboard" target="_blank">
              Outblog Dashboard
            </s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="/app/additional">
              App Settings
            </s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
  } catch (error) {
    console.error("Dashboard error:", error);
    return (
      <s-page heading="Error">
        <s-section heading="Something went wrong">
          <s-paragraph>
            <s-text>
              An error occurred while loading the dashboard. Please refresh the page and try again.
            </s-text>
          </s-paragraph>
          <s-button onClick={() => window.location.reload()}>
            Refresh Page
          </s-button>
        </s-section>
      </s-page>
    );
  }
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
