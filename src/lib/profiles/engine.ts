// v1.7 — My Profile, My Top 5, Shop, catalog and sharing engine (work order
// "My Profile, My Top 5, and Shop"; BRD v1.7 §7–8). Server-only. Takes an Sql
// argument so tests run it on PGlite. THE read rule lives in migration 0011
// (trufolks_viewer_relation, trufolks_profile_visible, trufolks_visible_reviews);
// every read here goes through it. Nothing here selects a receipt code, photo,
// purchase amount or payout field.
import type { Sql } from "../db.ts";
import { parseDisclosure } from "../reviews/disclosure.ts";
import type { ReviewView } from "../reviews/engine.ts";

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export type Relation = "owner" | "friend" | "member" | "anonymous" | "blocked";
export type ProfileAudience = "friends" | "public";
export type ReviewAudience = "contacts" | "public";
export type TopList = "products" | "services";
export const TOP_LISTS: readonly TopList[] = ["products", "services"];
export const TOP_MAX = 5;
export const BIO_MAX = 280;

export interface ProductRef {
  productId: string;
  slug: string;
  name: string;
  brand: string;
  model: string;
  variant: string | null;
  kind: "product" | "service";
  category: string;
  status: "pending" | "approved" | "rejected" | "merged";
  /** Only a release year the TruFolks team verified. */
  releaseYear: number | null;
}

export interface ShopOffer {
  offerId: string;
  sellerName: string;
  url: string;
  kind: "seller" | "brand";
  referralCommission: boolean;
}

export interface ProfileReview extends ReviewView {
  authorId: string;
  visibility: ReviewAudience;
  /** Verified, with a complete rating-blind disclosure: can be shown to others. */
  shareable: boolean;
  /** Approved records only, except on the owner's own view. */
  product: ProductRef | null;
  /** Approved offers only. */
  offers: ShopOffer[];
  /** The author's profile handle, when the viewer may open that profile. */
  authorHandle: string | null;
  /** The owner chose to list it in their Shop (SHOP-18-01). */
  inShop: boolean;
  /** It can be listed: shareable, approved catalog record, approved seller link. */
  shopEligible: boolean;
  shopAddedAt: string | null;
}

export interface ProfileView {
  /** Who is looking (the owner previewing as someone else gets that relation). */
  relation: Exclude<Relation, "blocked">;
  isOwner: boolean;
  profile: {
    userId: string;
    handle: string;
    name: string;
    bio: string;
    audience: ProfileAudience;
    publishedAt: string | null;
  };
  topPicks: Record<TopList, ProfileReview[]>;
  shop: ProfileReview[];
  reviews: ProfileReview[];
}

type VisibleRow = {
  review_id: string;
  author_id: string;
  reviewer_name: string;
  merchant_name: string;
  product_label: string;
  rating: number;
  what_used: string;
  how_long: string;
  honest_thought: string;
  verified: boolean;
  disclosure: unknown;
  visibility: string;
  shareable: boolean;
  created_at: unknown;
  p_id: string | null;
  p_slug: string | null;
  p_kind: string | null;
  p_model: string | null;
  p_variant: string | null;
  p_category: string | null;
  p_status: string | null;
  p_release_year: number | null;
  p_release_year_verified: boolean | null;
  b_name: string | null;
  author_handle: string | null;
  in_shop: boolean | null;
  shop_added_at: unknown;
  shop_eligible: boolean | null;
};

const PRODUCT_COLS = `
  cp.id as p_id, cp.slug as p_slug, cp.kind as p_kind, cp.model as p_model, cp.variant as p_variant,
  cp.category as p_category, cp.status as p_status, cp.release_year as p_release_year,
  cp.release_year_verified as p_release_year_verified, cb.name as b_name,
  si.review_id is not null as in_shop, si.added_at as shop_added_at,
  trufolks_shop_eligible(v.review_id) as shop_eligible`;

const PRODUCT_JOIN = `
  left join review_products rp on rp.review_id = v.review_id
  left join catalog_products cp on cp.id = rp.product_id
  left join catalog_brands cb on cb.id = cp.brand_id
  left join shop_items si on si.review_id = v.review_id and si.user_id = v.author_id`;

export function productName(brand: string, model: string, variant: string | null): string {
  return [brand, model, variant].filter(Boolean).join(" ");
}

function toProduct(r: VisibleRow, ownerView: boolean): ProductRef | null {
  if (!r.p_id || !r.p_slug || !r.p_status || !r.b_name || !r.p_model) return null;
  const status = r.p_status as ProductRef["status"];
  if (!ownerView && status !== "approved") return null;
  return {
    productId: r.p_id,
    slug: r.p_slug,
    name: productName(r.b_name, r.p_model, r.p_variant),
    brand: r.b_name,
    model: r.p_model,
    variant: r.p_variant,
    kind: r.p_kind === "service" ? "service" : "product",
    category: r.p_category ?? "",
    status,
    releaseYear: r.p_release_year_verified ? r.p_release_year : null,
  };
}

function toReview(r: VisibleRow, ownerView: boolean, offers: Map<string, ShopOffer[]>): ProfileReview {
  const product = toProduct(r, ownerView);
  return {
    reviewId: r.review_id,
    authorId: r.author_id,
    reviewerName: r.reviewer_name,
    merchantName: r.merchant_name,
    productLabel: r.product_label,
    rating: r.rating,
    whatUsed: r.what_used,
    howLong: r.how_long,
    honestThought: r.honest_thought,
    verifiedPurchase: r.verified,
    disclosure: parseDisclosure(r.disclosure),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    visibility: r.visibility === "public" ? "public" : "contacts",
    shareable: r.shareable,
    product,
    offers: product && product.status === "approved" ? (offers.get(product.productId) ?? []) : [],
    authorHandle: r.author_handle,
    inShop: r.in_shop === true,
    shopEligible: r.shop_eligible === true,
    shopAddedAt: iso(r.shop_added_at),
  };
}

/** Approved offers for these products, sellers before the brand's own shop, then by name. */
async function approvedOffers(sql: Sql, productIds: string[]): Promise<Map<string, ShopOffer[]>> {
  const out = new Map<string, ShopOffer[]>();
  if (productIds.length === 0) return out;
  const rows = await sql.query<{
    id: string;
    product_id: string;
    seller_name: string;
    url: string;
    offer_kind: string;
    referral_commission: boolean;
  }>(
    `select id, product_id, seller_name, url, offer_kind, referral_commission
       from seller_offers
      where status = 'approved' and product_id = any($1::text[])
      order by product_id, offer_kind desc, lower(seller_name), id`,
    [productIds],
  );
  for (const r of rows) {
    const list = out.get(r.product_id) ?? [];
    list.push({
      offerId: r.id,
      sellerName: r.seller_name,
      url: r.url,
      kind: r.offer_kind === "brand" ? "brand" : "seller",
      referralCommission: r.referral_commission,
    });
    out.set(r.product_id, list);
  }
  return out;
}

async function withOffers(sql: Sql, rows: VisibleRow[], ownerView: boolean): Promise<ProfileReview[]> {
  const ids = [...new Set(rows.filter((r) => r.p_id && r.p_status === "approved").map((r) => r.p_id as string))];
  const offers = await approvedOffers(sql, ids);
  return rows.map((r) => toReview(r, ownerView, offers));
}

/** Second lock: never hand a non-owner a review that isn't shareable (LEG-01). */
function guard(list: ProfileReview[], relation: Relation): ProfileReview[] {
  if (relation === "owner") return list;
  return list.filter(
    (r) =>
      r.shareable &&
      r.verifiedPurchase &&
      r.disclosure?.complete === true &&
      (relation === "friend" || r.visibility === "public"),
  );
}

// ------------------------------------------------------------------ relation

export async function viewerRelation(sql: Sql, ownerId: string, viewerId: string | null): Promise<Relation> {
  const rows = await sql.query<{ r: Relation }>(`select trufolks_viewer_relation($1, $2) as r`, [ownerId, viewerId]);
  return rows[0]?.r ?? "anonymous";
}

export async function ensureProfile(sql: Sql, userId: string): Promise<string | null> {
  if (!userId) return null;
  const rows = await sql.query<{ h: string | null }>(`select trufolks_ensure_profile($1) as h`, [userId]);
  return rows[0]?.h ?? null;
}

// ------------------------------------------------------------------ profile view

export type PreviewAs = "friend" | "anonymous";

/**
 * A profile as this viewer may see it. `previewAs` is honoured only for the
 * owner (the audience preview). Not visible, blocked or unknown → not_found,
 * so a visitor can't tell which.
 */
export async function getProfileView(
  sql: Sql,
  input: { handle?: string; ownerId?: string; viewerId: string | null; previewAs?: PreviewAs | null },
): Promise<{ outcome: "ok"; view: ProfileView } | { outcome: "not_found" }> {
  const handle = (input.handle ?? "").trim().toLowerCase();
  if (!handle && !input.ownerId) return { outcome: "not_found" };
  const rows = await sql.query<{
    user_id: string;
    handle: string;
    bio: string;
    audience: string;
    published_at: unknown;
    display_name: string;
  }>(
    `select p.user_id, p.handle, p.bio, p.audience, p.published_at, u.display_name
       from profiles p join users u on u.id = p.user_id and u.deleted_at is null
      where ${input.ownerId ? "p.user_id = $1" : "p.handle = $1"}`,
    [input.ownerId ?? handle],
  );
  const p = rows[0];
  if (!p) return { outcome: "not_found" };
  const actual = await viewerRelation(sql, p.user_id, input.viewerId);
  if (actual === "blocked") return { outcome: "not_found" };
  const relation: Exclude<Relation, "blocked"> =
    actual === "owner" && input.previewAs ? input.previewAs : actual;
  const visible = await sql.query<{ v: boolean }>(`select trufolks_profile_visible($1, $2) as v`, [
    p.user_id,
    relation,
  ]);
  if (!visible[0]?.v) {
    // The owner previewing "anyone" on a Friends-only profile sees that nobody else can.
    if (actual === "owner") return { outcome: "ok", view: emptyView(p, relation) };
    return { outcome: "not_found" };
  }
  const ownerView = relation === "owner";
  const reviewRows = await sql.query<VisibleRow>(
    `select v.*, ${PRODUCT_COLS}, $3::text as author_handle
       from trufolks_visible_reviews($1, $2) v
       ${PRODUCT_JOIN}
      order by v.created_at desc, v.review_id desc
      limit 200`,
    [p.user_id, relation, p.handle],
  );
  const reviews = guard(await withOffers(sql, reviewRows, ownerView), relation);
  const byId = new Map(reviews.map((r) => [r.reviewId, r]));

  const picks = await sql.query<{ list: TopList; review_id: string }>(
    `select list, review_id from top_picks where user_id = $1 order by list, position`,
    [p.user_id],
  );
  const topPicks: Record<TopList, ProfileReview[]> = { products: [], services: [] };
  for (const pick of picks) {
    const r = byId.get(pick.review_id);
    if (r && (ownerView || r.shareable)) topPicks[pick.list].push(r);
  }
  // Shop: only what the owner chose (a Top 5 pin doesn't add an item), and only
  // while the viewer may read the review and an approved seller link exists.
  const shop = reviews
    .filter((r) => r.inShop && r.shareable && r.product?.status === "approved" && r.offers.length > 0)
    .sort((a, b) => (b.shopAddedAt ?? "").localeCompare(a.shopAddedAt ?? ""));

  return {
    outcome: "ok",
    view: {
      relation,
      isOwner: actual === "owner",
      profile: {
        userId: p.user_id,
        handle: p.handle,
        name: p.display_name,
        bio: p.bio,
        audience: p.audience === "public" ? "public" : "friends",
        publishedAt: iso(p.published_at),
      },
      topPicks,
      shop,
      reviews,
    },
  };
}

function emptyView(
  p: { user_id: string; handle: string; bio: string; audience: string; published_at: unknown; display_name: string },
  relation: Exclude<Relation, "blocked">,
): ProfileView {
  return {
    relation,
    isOwner: true,
    profile: {
      userId: p.user_id,
      handle: p.handle,
      name: p.display_name,
      bio: "",
      audience: p.audience === "public" ? "public" : "friends",
      publishedAt: iso(p.published_at),
    },
    topPicks: { products: [], services: [] },
    shop: [],
    reviews: [],
  };
}

// ------------------------------------------------------------------ owner writes

export type ProfileOutcome =
  | "ok"
  | "not_found"
  | "invalid"
  | "not_shareable"
  | "too_many"
  | "duplicate"
  | "not_eligible"
  | "in_other_list"
  | "conflict"
  | "unavailable";

export async function setBio(sql: Sql, input: { userId: string; bio: unknown }): Promise<ProfileOutcome> {
  if (typeof input.bio !== "string" || input.bio.length > BIO_MAX) return "invalid";
  const rows = await sql.query<{ r: string }>(`select trufolks_set_profile_bio($1, $2) as r`, [input.userId, input.bio]);
  return (rows[0]?.r as ProfileOutcome) ?? "unavailable";
}

export const NAME_MAX = 60;

/** The display name on the profile and on every review the person wrote (PRO-18-02). */
export async function setDisplayName(sql: Sql, input: { userId: string; name: unknown }): Promise<ProfileOutcome> {
  if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > NAME_MAX) return "invalid";
  const rows = await sql.query<{ r: string }>(`select trufolks_set_display_name($1, $2) as r`, [input.userId, input.name]);
  return (rows[0]?.r as ProfileOutcome) ?? "unavailable";
}

/** Show (or stop showing) one of your reviews in your Shop (SHOP-18-01). Off by default. */
export async function setShopItem(
  sql: Sql,
  input: { userId: string; reviewId: string; on: unknown },
): Promise<ProfileOutcome> {
  if (typeof input.on !== "boolean") return "invalid";
  if (!input.reviewId) return "not_found";
  const rows = await sql.query<{ r: string }>(`select trufolks_set_shop_item($1, $2, $3) as r`, [
    input.userId,
    input.reviewId,
    input.on,
  ]);
  return (rows[0]?.r as ProfileOutcome) ?? "unavailable";
}

export async function setProfileAudience(
  sql: Sql,
  input: { userId: string; audience: unknown },
): Promise<ProfileOutcome> {
  if (input.audience !== "friends" && input.audience !== "public") return "invalid";
  const rows = await sql.query<{ r: string }>(`select trufolks_set_profile_audience($1, $2) as r`, [
    input.userId,
    input.audience,
  ]);
  return (rows[0]?.r as ProfileOutcome) ?? "unavailable";
}

export async function setReviewAudience(
  sql: Sql,
  input: { userId: string; reviewId: string; audience: unknown },
): Promise<ProfileOutcome> {
  if (input.audience !== "contacts" && input.audience !== "public") return "invalid";
  if (!input.reviewId) return "not_found";
  const rows = await sql.query<{ r: string }>(`select trufolks_set_review_audience($1, $2, $3) as r`, [
    input.userId,
    input.reviewId,
    input.audience,
  ]);
  return (rows[0]?.r as ProfileOutcome) ?? "unavailable";
}

/** Replace one Top 5 list with these reviews, in this order. */
export async function setTopPicks(
  sql: Sql,
  input: { userId: string; list: unknown; reviewIds: unknown },
): Promise<ProfileOutcome> {
  if (input.list !== "products" && input.list !== "services") return "invalid";
  if (!Array.isArray(input.reviewIds) || !input.reviewIds.every((x) => typeof x === "string" && x.length <= 100)) {
    return "invalid";
  }
  if (input.reviewIds.length > TOP_MAX) return "too_many";
  const rows = await sql.query<{ r: string }>(`select trufolks_set_top_picks($1, $2, $3::text[]) as r`, [
    input.userId,
    input.list,
    input.reviewIds,
  ]);
  return (rows[0]?.r as ProfileOutcome) ?? "unavailable";
}

// ------------------------------------------------------------------ Add a review: the shopper's purchases

export type PurchaseState = "pending_photo" | "pending" | "rejected" | "not_ready" | "ready" | "posted";

export interface MyPurchase {
  purchaseId: string;
  merchantName: string;
  productLabel: string;
  campaignName: string | null;
  purchasedAt: string;
  state: PurchaseState;
  reviewId: string | null;
}

/** The person's own purchases, newest first, with where each one stands. */
export async function myPurchases(sql: Sql, input: { userId: string }): Promise<MyPurchase[]> {
  if (!input.userId) return [];
  const rows = await sql.query<{
    id: string;
    verification_status: string;
    merchant_name: string;
    product_label: string;
    campaign_name: string | null;
    purchased_at: unknown;
    review_id: string | null;
    has_photo: boolean;
    reward_status: string | null;
  }>(
    `select vp.id, vp.verification_status, m.name as merchant_name, vp.product_label, c.name as campaign_name,
            vp.purchased_at, r.id as review_id,
            exists (select 1 from receipt_photos ph where ph.verified_purchase_id = vp.id) as has_photo,
            case when vp.verification_status = 'verified' and r.id is null
                 then trufolks_review_disclosure(vp.id) -> 'reward' ->> 'status' end as reward_status
       from verified_purchases vp
       join merchants m on m.id = vp.merchant_id
       left join campaigns c on c.id = vp.campaign_id
       left join reviews r on r.verified_purchase_id = vp.id
      where vp.user_id = $1
      order by vp.created_at desc, vp.id desc
      limit 100`,
    [input.userId],
  );
  return rows.map((r) => {
    let state: PurchaseState;
    if (r.review_id) state = "posted";
    else if (r.verification_status === "rejected") state = "rejected";
    else if (r.verification_status === "pending") state = r.has_photo ? "pending" : "pending_photo";
    else state = r.reward_status === "not_set" ? "not_ready" : "ready";
    return {
      purchaseId: r.id,
      merchantName: r.merchant_name,
      productLabel: r.product_label,
      campaignName: r.campaign_name,
      purchasedAt: iso(r.purchased_at) ?? "",
      state,
      reviewId: r.review_id,
    };
  });
}

// ------------------------------------------------------------------ one review

export async function getReviewPage(
  sql: Sql,
  input: { reviewId: string; viewerId: string | null },
): Promise<{ outcome: "ok"; review: ProfileReview; relation: Relation } | { outcome: "not_found" }> {
  if (!input.reviewId || input.reviewId.length > 100) return { outcome: "not_found" };
  const author = await sql.query<{ user_id: string }>(`select user_id from reviews where id = $1`, [input.reviewId]);
  const authorId = author[0]?.user_id;
  if (!authorId) return { outcome: "not_found" };
  const relation = await viewerRelation(sql, authorId, input.viewerId);
  if (relation === "blocked") return { outcome: "not_found" };
  const rows = await sql.query<VisibleRow>(
    `select v.*, ${PRODUCT_COLS},
            case when trufolks_profile_visible($1, $2) then (select handle from profiles where user_id = $1) end as author_handle
       from trufolks_visible_reviews($1, $2) v
       ${PRODUCT_JOIN}
      where v.review_id = $3`,
    [authorId, relation, input.reviewId],
  );
  const list = guard(await withOffers(sql, rows, relation === "owner"), relation);
  if (!list[0]) return { outcome: "not_found" };
  return { outcome: "ok", review: list[0], relation };
}

// ------------------------------------------------------------------ product page

export interface ProductPage {
  product: ProductRef;
  offers: ShopOffer[];
  reviews: ProfileReview[];
}

/**
 * An approved catalog record with the reviews this viewer may read. A guest
 * only gets a page when at least one public review exists. A merged record
 * points at the one it was merged into.
 */
export async function getProductPage(
  sql: Sql,
  input: { slug: string; viewerId: string | null },
): Promise<{ outcome: "ok"; page: ProductPage } | { outcome: "moved"; slug: string } | { outcome: "not_found" }> {
  const slug = (input.slug ?? "").trim().toLowerCase();
  if (!slug || slug.length > 120) return { outcome: "not_found" };
  const found = await sql.query<{
    id: string;
    status: string;
    merged_slug: string | null;
  }>(
    `select cp.id, cp.status, t.slug as merged_slug
       from catalog_products cp left join catalog_products t on t.id = cp.merged_into
      where cp.slug = $1`,
    [slug],
  );
  const f = found[0];
  if (!f) return { outcome: "not_found" };
  if (f.status === "merged" && f.merged_slug) return { outcome: "moved", slug: f.merged_slug };
  if (f.status !== "approved") return { outcome: "not_found" };
  const rows = await sql.query<VisibleRow>(
    `select v.*, ${PRODUCT_COLS},
            case when trufolks_profile_visible(a.user_id, a.rel) then pr.handle end as author_handle
       from (select distinct r.user_id, trufolks_viewer_relation(r.user_id, $2) as rel
               from review_products x join reviews r on r.id = x.review_id
              where x.product_id = $1) a
       cross join lateral trufolks_visible_reviews(a.user_id, a.rel) v
       join review_products rp0 on rp0.review_id = v.review_id and rp0.product_id = $1
       left join profiles pr on pr.user_id = a.user_id
       ${PRODUCT_JOIN}
      where a.rel <> 'blocked' and v.shareable
      order by v.created_at desc, v.review_id desc
      limit 100`,
    [f.id, input.viewerId],
  );
  // Product pages only ever list shareable reviews, even the viewer's own.
  const reviews = (await withOffers(sql, rows, false)).filter(
    (r) => r.shareable && r.disclosure?.complete === true && r.product?.status === "approved",
  );
  if (reviews.length === 0) return { outcome: "not_found" };
  const product = reviews[0].product as ProductRef;
  return { outcome: "ok", page: { product, offers: reviews[0].offers, reviews } };
}

// ------------------------------------------------------------------ catalog links (author)

export interface LinkInput {
  kind: unknown;
  brand: unknown;
  model: unknown;
  variant?: unknown;
  category: unknown;
  gtin?: unknown;
  mpn?: unknown;
  offerSeller?: unknown;
  offerUrl?: unknown;
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max + 1) : "";
}

/** Link the author's own review to a catalog record (match or queue a new one). */
export async function linkReviewProduct(
  sql: Sql,
  input: { userId: string; reviewId: string; fields: LinkInput },
): Promise<
  | { outcome: "ok"; productId: string; status: ProductRef["status"]; method: string }
  | { outcome: "not_found" | "invalid" | "unavailable" }
> {
  const f = input.fields;
  const kind = f.kind === "service" ? "service" : f.kind === "product" ? "product" : "";
  if (!kind || !input.reviewId) return { outcome: kind ? "not_found" : "invalid" };
  const rows = await sql.query<{ r_outcome: string; r_product_id: string | null; r_status: string | null; r_method: string | null }>(
    `select * from trufolks_link_review_product($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      input.userId,
      input.reviewId,
      kind,
      str(f.brand, 80),
      str(f.model, 120),
      str(f.variant, 80),
      str(f.category, 60),
      str(f.gtin, 20),
      str(f.mpn, 60),
      str(f.offerSeller, 80),
      str(f.offerUrl, 500),
    ],
  );
  const r = rows[0];
  if (!r) return { outcome: "unavailable" };
  if (r.r_outcome !== "ok" || !r.r_product_id) return { outcome: r.r_outcome === "not_found" ? "not_found" : "invalid" };
  return {
    outcome: "ok",
    productId: r.r_product_id,
    status: (r.r_status ?? "pending") as ProductRef["status"],
    method: r.r_method ?? "",
  };
}

/** Anyone who can see a product page can ask the team to correct it. */
export async function requestCorrection(
  sql: Sql,
  input: { userId: string; slug: string; note: unknown },
): Promise<ProfileOutcome> {
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (!note || note.length > 500) return "invalid";
  const page = await getProductPage(sql, { slug: input.slug, viewerId: input.userId });
  if (page.outcome !== "ok") return "not_found";
  await sql.query(`insert into catalog_corrections (product_id, user_id, note) values ($1, $2, $3)`, [
    page.page.product.productId,
    input.userId,
    note,
  ]);
  return "ok";
}

// ------------------------------------------------------------------ catalog admin

export interface QueueProduct {
  productId: string;
  slug: string;
  name: string;
  brand: string;
  model: string;
  variant: string | null;
  kind: "product" | "service";
  category: string;
  gtin: string | null;
  mpn: string | null;
  releaseYear: number | null;
  releaseYearVerified: boolean;
  status: ProductRef["status"];
  matchNote: string | null;
  similarTo: { productId: string; name: string; status: string } | null;
  reviewCount: number;
  createdAt: string;
}

export interface QueueOffer {
  offerId: string;
  productId: string;
  productName: string;
  sellerName: string;
  url: string;
  kind: "seller" | "brand";
  referralCommission: boolean;
  status: string;
}

export interface QueueCorrection {
  correctionId: string;
  productId: string;
  productName: string;
  slug: string;
  note: string;
  createdAt: string;
}

export interface CatalogAdminView {
  pending: QueueProduct[];
  approved: QueueProduct[];
  offers: QueueOffer[];
  corrections: QueueCorrection[];
}

type ProductAdminRow = {
  id: string;
  slug: string;
  kind: string;
  model: string;
  variant: string | null;
  category: string;
  gtin: string | null;
  mpn: string | null;
  release_year: number | null;
  release_year_verified: boolean;
  status: string;
  match_note: string | null;
  created_at: unknown;
  brand: string;
  similar_id: string | null;
  similar_brand: string | null;
  similar_model: string | null;
  similar_variant: string | null;
  similar_status: string | null;
  review_count: number | string;
};

function toQueue(r: ProductAdminRow): QueueProduct {
  return {
    productId: r.id,
    slug: r.slug,
    name: productName(r.brand, r.model, r.variant),
    brand: r.brand,
    model: r.model,
    variant: r.variant,
    kind: r.kind === "service" ? "service" : "product",
    category: r.category,
    gtin: r.gtin,
    mpn: r.mpn,
    releaseYear: r.release_year,
    releaseYearVerified: r.release_year_verified,
    status: r.status as ProductRef["status"],
    matchNote: r.match_note,
    similarTo:
      r.similar_id && r.similar_brand && r.similar_model
        ? {
            productId: r.similar_id,
            name: productName(r.similar_brand, r.similar_model, r.similar_variant),
            status: r.similar_status ?? "",
          }
        : null,
    reviewCount: Number(r.review_count),
    createdAt: iso(r.created_at) ?? "",
  };
}

const ADMIN_PRODUCT_SQL = `
  select cp.id, cp.slug, cp.kind, cp.model, cp.variant, cp.category, cp.gtin, cp.mpn, cp.release_year,
         cp.release_year_verified, cp.status, cp.match_note, cp.created_at, cb.name as brand,
         s.id as similar_id, sb.name as similar_brand, s.model as similar_model, s.variant as similar_variant,
         s.status as similar_status,
         (select count(*) from review_products rp where rp.product_id = cp.id) as review_count
    from catalog_products cp
    join catalog_brands cb on cb.id = cp.brand_id
    left join catalog_products s on s.id = cp.similar_to
    left join catalog_brands sb on sb.id = s.brand_id`;

export async function catalogAdminView(sql: Sql): Promise<CatalogAdminView> {
  const pending = await sql.query<ProductAdminRow>(
    `${ADMIN_PRODUCT_SQL} where cp.status = 'pending' order by cp.created_at, cp.id limit 200`,
  );
  const approved = await sql.query<ProductAdminRow>(
    `${ADMIN_PRODUCT_SQL} where cp.status = 'approved' order by lower(cb.name), lower(cp.model), cp.variant_norm limit 500`,
  );
  const offers = await sql.query<{
    id: string;
    product_id: string;
    brand: string;
    model: string;
    variant: string | null;
    seller_name: string;
    url: string;
    offer_kind: string;
    referral_commission: boolean;
    status: string;
  }>(
    `select o.id, o.product_id, cb.name as brand, cp.model, cp.variant, o.seller_name, o.url, o.offer_kind,
            o.referral_commission, o.status
       from seller_offers o
       join catalog_products cp on cp.id = o.product_id
       join catalog_brands cb on cb.id = cp.brand_id
      where o.status in ('pending', 'approved') and cp.status in ('pending', 'approved')
      order by (o.status = 'pending') desc, o.created_at desc
      limit 500`,
  );
  const corrections = await sql.query<{
    id: string;
    product_id: string;
    brand: string;
    model: string;
    variant: string | null;
    slug: string;
    note: string;
    created_at: unknown;
  }>(
    `select c.id, c.product_id, cb.name as brand, cp.model, cp.variant, cp.slug, c.note, c.created_at
       from catalog_corrections c
       join catalog_products cp on cp.id = c.product_id
       join catalog_brands cb on cb.id = cp.brand_id
      where c.status = 'open'
      order by c.created_at
      limit 200`,
  );
  return {
    pending: pending.map(toQueue),
    approved: approved.map(toQueue),
    offers: offers.map((o) => ({
      offerId: o.id,
      productId: o.product_id,
      productName: productName(o.brand, o.model, o.variant),
      sellerName: o.seller_name,
      url: o.url,
      kind: o.offer_kind === "brand" ? "brand" : "seller",
      referralCommission: o.referral_commission,
      status: o.status,
    })),
    corrections: corrections.map((c) => ({
      correctionId: c.id,
      productId: c.product_id,
      productName: productName(c.brand, c.model, c.variant),
      slug: c.slug,
      note: c.note,
      createdAt: iso(c.created_at) ?? "",
    })),
  };
}

export async function adminDecideProduct(
  sql: Sql,
  input: { adminId: string; productId: string; action: unknown; targetId?: string | null },
): Promise<ProfileOutcome> {
  if (input.action !== "approve" && input.action !== "reject" && input.action !== "merge") return "invalid";
  const rows = await sql.query<{ r: string }>(`select trufolks_admin_decide_product($1, $2, $3, $4) as r`, [
    input.adminId,
    input.productId,
    input.action,
    input.targetId ?? null,
  ]);
  return (rows[0]?.r as ProfileOutcome) ?? "unavailable";
}

/** Correct a record's details (the correction path). The slug never changes. */
export async function adminUpdateProduct(
  sql: Sql,
  input: {
    adminId: string;
    productId: string;
    fields: {
      kind: unknown;
      brand: unknown;
      model: unknown;
      variant: unknown;
      category: unknown;
      gtin: unknown;
      mpn: unknown;
      releaseYear: unknown;
      releaseYearVerified: unknown;
    };
  },
): Promise<ProfileOutcome> {
  const f = input.fields;
  const kind = f.kind === "service" ? "service" : f.kind === "product" ? "product" : "";
  const brand = str(f.brand, 80);
  const model = str(f.model, 120);
  const variant = str(f.variant, 80) || null;
  const category = str(f.category, 60);
  const gtin = str(f.gtin, 20).replace(/[^0-9]/g, "") || null;
  const mpn = str(f.mpn, 60) || null;
  const yearRaw = typeof f.releaseYear === "number" ? f.releaseYear : Number(str(f.releaseYear, 4) || NaN);
  const year = Number.isInteger(yearRaw) ? yearRaw : null;
  const verified = f.releaseYearVerified === true;
  if (
    !kind ||
    !brand ||
    brand.length > 80 ||
    !model ||
    model.length > 120 ||
    (variant && variant.length > 80) ||
    !category ||
    category.length > 60 ||
    (gtin && !/^[0-9]{8,14}$/.test(gtin)) ||
    (mpn && mpn.length > 60) ||
    (year !== null && (year < 1900 || year > 2100)) ||
    (verified && year === null)
  ) {
    return "invalid";
  }
  try {
    const b = await sql.query<{ id: string | null }>(`select trufolks_catalog_brand($1) as id`, [brand]);
    const rows = await sql.query<{ id: string }>(
      `update catalog_products
          set kind = $2, brand_id = $3, model = $4, model_norm = trufolks_norm($4), variant = $5,
              variant_norm = trufolks_norm($5), category = $6, gtin = $7, mpn = $8, release_year = $9,
              release_year_verified = $10, reviewed_by = $11, reviewed_at = now(), updated_at = now()
        where id = $1 and status in ('pending', 'approved')
        returning id`,
      [input.productId, kind, b[0]?.id, model, variant, category, gtin, mpn, year, verified, input.adminId],
    );
    return rows[0] ? "ok" : "not_found";
  } catch (err) {
    // Unique identity or identifier clash with another live record.
    if (err instanceof Error && /unique|duplicate/i.test(err.message)) return "conflict";
    throw err;
  }
}

export async function adminDecideOffer(
  sql: Sql,
  input: { adminId: string; offerId: string; action: unknown; referralCommission?: unknown },
): Promise<ProfileOutcome> {
  const status =
    input.action === "approve" ? "approved" : input.action === "reject" ? "rejected" : input.action === "withdraw" ? "withdrawn" : null;
  if (!status) return "invalid";
  const rows = await sql.query<{ id: string }>(
    `update seller_offers
        set status = $2, reviewed_by = $3, reviewed_at = now(),
            referral_commission = coalesce($4::boolean, referral_commission)
      where id = $1 and status in ('pending', 'approved')
      returning id`,
    [input.offerId, status, input.adminId, typeof input.referralCommission === "boolean" ? input.referralCommission : null],
  );
  return rows[0] ? "ok" : "not_found";
}

export async function adminAddOffer(
  sql: Sql,
  input: { adminId: string; productId: string; sellerName: unknown; url: unknown; kind: unknown; referralCommission: unknown },
): Promise<ProfileOutcome> {
  const seller = str(input.sellerName, 80);
  const url = str(input.url, 500);
  const kind = input.kind === "brand" ? "brand" : "seller";
  if (!seller || seller.length > 80 || !/^https:\/\/\S+$/.test(url) || url.length > 500) return "invalid";
  const rows = await sql.query<{ id: string }>(
    `insert into seller_offers (product_id, seller_name, url, offer_kind, referral_commission, status, submitted_by, reviewed_by, reviewed_at)
     select id, $2, $3, $4, $5, 'approved', $6, $6, now() from catalog_products where id = $1 and status in ('pending', 'approved')
     returning id`,
    [input.productId, seller, url, kind, input.referralCommission === true, input.adminId],
  );
  return rows[0] ? "ok" : "not_found";
}

export async function adminResolveCorrection(
  sql: Sql,
  input: { adminId: string; correctionId: string; action: unknown },
): Promise<ProfileOutcome> {
  const status = input.action === "resolve" ? "resolved" : input.action === "dismiss" ? "dismissed" : null;
  if (!status) return "invalid";
  const rows = await sql.query<{ id: string }>(
    `update catalog_corrections set status = $2, resolved_by = $3, resolved_at = now()
      where id = $1 and status = 'open' returning id`,
    [input.correctionId, status, input.adminId],
  );
  return rows[0] ? "ok" : "not_found";
}
