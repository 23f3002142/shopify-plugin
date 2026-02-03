// Simple in-memory storage for development
// Note: This will reset on server restart

interface MemoryShopSettings {
  id: string;
  shop: string;
  apiKey?: string;
  postAsDraft: boolean;
  lastSyncAt?: Date;
  blogs: MemoryBlogPost[];
}

interface MemoryBlogPost {
  id: string;
  externalId?: string;
  slug: string;
  title: string;
  content?: string;
  metaDescription?: string;
  featuredImage?: string;
  status: string;
  categories?: string;
  tags?: string;
  shopifyArticleId?: string;
  createdAt: Date;
  updatedAt: Date;
}

class MemoryStore {
  private shops = new Map<string, MemoryShopSettings>();

  // Shop Settings
  async getShopSettings(shop: string): Promise<MemoryShopSettings | null> {
    return this.shops.get(shop) || null;
  }

  async createShopSettings(shop: string): Promise<MemoryShopSettings> {
    const settings: MemoryShopSettings = {
      id: crypto.randomUUID(),
      shop,
      postAsDraft: true,
      blogs: [],
    };
    this.shops.set(shop, settings);
    return settings;
  }

  async upsertShopSettings(shop: string, data: Partial<MemoryShopSettings>): Promise<MemoryShopSettings> {
    let settings = await this.getShopSettings(shop);
    if (!settings) {
      settings = await this.createShopSettings(shop);
    }
    
    Object.assign(settings, data);
    this.shops.set(shop, settings);
    return settings;
  }

  // Blog Posts
  async getBlogPosts(shop: string, skip = 0, take = 10, filter?: (post: MemoryBlogPost) => boolean): Promise<{ posts: MemoryBlogPost[], total: number }> {
    const settings = await this.getShopSettings(shop);
    if (!settings) return { posts: [], total: 0 };

    let filteredPosts = settings.blogs;
    if (filter) {
      filteredPosts = settings.blogs.filter(filter);
    }

    const posts = filteredPosts
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(skip, skip + take);
    
    return { posts, total: filteredPosts.length };
  }

  async upsertBlogPost(shop: string, data: Partial<MemoryBlogPost> & { slug: string }): Promise<MemoryBlogPost> {
    const settings = await this.getShopSettings(shop);
    if (!settings) throw new Error('Shop settings not found');

    const existingIndex = settings.blogs.findIndex(post => post.slug === data.slug);
    const now = new Date();
    
    const post: MemoryBlogPost = {
      id: data.id || crypto.randomUUID(),
      slug: data.slug,
      title: data.title || 'Untitled',
      content: data.content,
      metaDescription: data.metaDescription,
      featuredImage: data.featuredImage,
      status: data.status || 'draft',
      categories: data.categories,
      tags: data.tags,
      shopifyArticleId: data.shopifyArticleId,
      createdAt: data.createdAt || now,
      updatedAt: now,
    };

    if (existingIndex >= 0) {
      settings.blogs[existingIndex] = post;
    } else {
      settings.blogs.push(post);
    }

    this.shops.set(shop, settings);
    return post;
  }

  async findBlogPost(shop: string, id: string): Promise<MemoryBlogPost | null> {
    const settings = await this.getShopSettings(shop);
    if (!settings) return null;

    return settings.blogs.find(post => post.id === id) || null;
  }

  async updateBlogPost(shop: string, id: string, data: Partial<MemoryBlogPost>): Promise<MemoryBlogPost> {
    const settings = await this.getShopSettings(shop);
    if (!settings) throw new Error('Shop settings not found');

    const postIndex = settings.blogs.findIndex(post => post.id === id);
    if (postIndex === -1) throw new Error('Blog post not found');

    settings.blogs[postIndex] = {
      ...settings.blogs[postIndex],
      ...data,
      updatedAt: new Date(),
    };

    this.shops.set(shop, settings);
    return settings.blogs[postIndex];
  }

  async updateManyBlogPosts(shop: string, ids: string[], data: Partial<MemoryBlogPost>): Promise<void> {
    const settings = await this.getShopSettings(shop);
    if (!settings) throw new Error('Shop settings not found');

    settings.blogs = settings.blogs.map(post => {
      if (ids.includes(post.id)) {
        return {
          ...post,
          ...data,
          updatedAt: new Date(),
        };
      }
      return post;
    });

    this.shops.set(shop, settings);
  }

  async deleteShopSettings(shop: string): Promise<void> {
    this.shops.delete(shop);
  }
}

export const memoryStore = new MemoryStore();
