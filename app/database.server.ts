import prisma from "./db.server";

export interface ShopSettingsData {
  apiKey?: string;
  postAsDraft?: boolean;
  lastSyncAt?: Date;
}

export interface BlogPostData {
  externalId?: string;
  slug: string;
  title: string;
  content?: string;
  metaDescription?: string;
  featuredImage?: string;
  status?: string;
  categories?: string;
  tags?: string;
  shopifyArticleId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export class DatabaseStore {
  // Shop Settings
  async getShopSettings(shop: string) {
    return await prisma.shopSettings.findUnique({
      where: { shop },
      include: { blogs: true }
    });
  }

  async createShopSettings(shop: string) {
    return await prisma.shopSettings.create({
      data: { shop },
      include: { blogs: true }
    });
  }

  async upsertShopSettings(shop: string, data: ShopSettingsData) {
    return await prisma.shopSettings.upsert({
      where: { shop },
      update: data,
      create: { shop, ...data },
      include: { blogs: true }
    });
  }

  // Blog Posts
  async getBlogPosts(shop: string, skip = 0, take = 10) {
    const settings = await this.getShopSettings(shop);
    if (!settings) return { posts: [], total: 0 };

    const [posts, total] = await Promise.all([
      prisma.outblogPost.findMany({
        where: { shopSettingsId: settings.id },
        skip,
        take,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.outblogPost.count({
        where: { shopSettingsId: settings.id }
      })
    ]);

    return { posts, total };
  }

  async upsertBlogPost(shop: string, data: BlogPostData & { slug: string }) {
    const settings = await this.getShopSettings(shop);
    if (!settings) throw new Error('Shop settings not found');

    return await prisma.outblogPost.upsert({
      where: {
        shopSettingsId_slug: {
          shopSettingsId: settings.id,
          slug: data.slug
        }
      },
      update: data,
      create: {
        shopSettingsId: settings.id,
        ...data
      }
    });
  }

  async findBlogPost(shop: string, id: string) {
    const settings = await this.getShopSettings(shop);
    if (!settings) return null;

    return await prisma.outblogPost.findFirst({
      where: {
        id,
        shopSettingsId: settings.id
      }
    });
  }

  async updateBlogPost(shop: string, id: string, data: Partial<BlogPostData>) {
    const settings = await this.getShopSettings(shop);
    if (!settings) throw new Error('Shop settings not found');

    return await prisma.outblogPost.update({
      where: {
        id,
        shopSettingsId: settings.id
      },
      data
    });
  }

  async updateManyBlogPosts(shop: string, ids: string[], data: Partial<BlogPostData>) {
    const settings = await this.getShopSettings(shop);
    if (!settings) throw new Error('Shop settings not found');

    return await prisma.outblogPost.updateMany({
      where: {
        id: { in: ids },
        shopSettingsId: settings.id
      },
      data
    });
  }
}

export const databaseStore = new DatabaseStore();
