# Outblog Shopify Extension

This Shopify app integrates with Outblog AI to automatically sync and publish SEO-optimized blog posts to your Shopify store.

## Features

1. **API Key Authentication** - Connect your Shopify store with your Outblog account using an API key
2. **Blog Sync** - Fetch blogs from Outblog backend and store them locally
3. **Publish to Shopify** - Publish individual or all blogs to your Shopify store's blog section
4. **Auto-sync (Cron)** - Daily automatic sync of new blog posts
5. **Draft/Publish Mode** - Choose whether to save posts as drafts or publish directly

## Setup Instructions

### 1. Install Dependencies

```bash
cd plugins/shopify-plugin/outblog
npm install
```

### 2. Set Up Database

```bash
npx prisma generate
npx prisma migrate dev --name init
```

### 3. Configure Environment Variables

Create a `.env` file with:

```env
SHOPIFY_API_KEY=your_shopify_api_key
SHOPIFY_API_SECRET=your_shopify_api_secret
SCOPES=write_products,read_content,write_content
SHOPIFY_APP_URL=https://your-app-url.com
CRON_SECRET=your_random_cron_secret
```

### 4. Run Development Server

```bash
npm run dev
```

## Usage

### Initial Setup

1. Install the app on your Shopify store
2. You'll be prompted to enter your Outblog API key
3. Get your API key from [outblogai.com/dashboard](https://www.outblogai.com/dashboard)
4. Enter the API key and choose your post mode (draft or publish)
5. Click "Save & Connect"

### Fetching Blogs

1. Click the "Fetch Blogs" button to sync blogs from Outblog
2. Blogs will be displayed in a paginated table
3. Each blog shows title, image, status, and creation date

### Publishing to Shopify

1. Click "Publish" on individual blogs to publish them to Shopify
2. Or click "Publish All to Shopify" to publish all unpublished blogs
3. Blogs are published under the "Outblog" blog category in Shopify

### Daily Auto-Sync (Cron)

Set up an external cron service to call the sync endpoint daily:

```
GET /api/cron?secret=YOUR_CRON_SECRET
```

Or use POST:

```
POST /api/cron
Body: { "secret": "YOUR_CRON_SECRET" }
```

Recommended cron services:
- [cron-job.org](https://cron-job.org)
- Vercel Cron Jobs
- GitHub Actions scheduled workflows

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/app` | GET | Main app dashboard |
| `/api/cron` | GET/POST | Trigger daily sync for all shops |

## Database Schema

### ShopSettings
- `id` - Unique identifier
- `shop` - Shopify shop domain
- `apiKey` - Outblog API key
- `postAsDraft` - Whether to save posts as drafts
- `lastSyncAt` - Last sync timestamp

### OutblogPost
- `id` - Unique identifier
- `shopSettingsId` - Reference to ShopSettings
- `externalId` - Outblog post ID
- `slug` - URL slug
- `title` - Post title
- `content` - Post content (markdown)
- `metaDescription` - SEO meta description
- `featuredImage` - Featured image URL
- `status` - Post status (draft/published)
- `categories` - JSON array of categories
- `tags` - JSON array of tags
- `shopifyArticleId` - Shopify article ID after publishing

## Troubleshooting

### API Key Validation Failed
- Ensure your API key is correct
- Check if your Outblog account is active
- Verify the API endpoint is accessible

### Blogs Not Syncing
- Check your API key is saved correctly
- Verify you have published blogs in Outblog
- Check the browser console for errors

### Publishing Failed
- Ensure the app has `write_content` scope
- Check if the blog already exists in Shopify
- Verify Shopify API rate limits

## Support

For issues with the Shopify app, please contact support.
For Outblog-related issues, visit [outblogai.com](https://www.outblogai.com).
