const API_URL = "https://api.buffer.com";
const API_KEY_STORAGE = "bufferApiKey";
const ORGANIZATION_STORAGE = "bufferOrganizationId";
const LEGACY_OAUTH_STORAGE = "bufferTokens";

type ChromeStorageArea = {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  setAccessLevel?(options: { accessLevel: "TRUSTED_CONTEXTS" }): Promise<void>;
};

declare const chrome: { storage: { local: ChromeStorageArea } };

type MetricSummary = { posts: number | null; likes: number | null; comments: number | null; exposure: number | null; engagementRate: number | null; clicks: number | null };

export type DashboardStats = {
  organization: { id: string; name: string };
  window: { startDateTime: string; endDateTime: string };
  metricsUpdatedAt: string | null;
  stats: MetricSummary;
  exposureTimeline: Array<{ date: string; exposure: number | null }>;
  dev: {
    baselineWindow: { startDateTime: string; endDateTime: string }; baseline: MetricSummary;
    components: string[]; currentInteractions: number; baselineInteractions: number; gain: number;
    progressRatio: number | null; engagementChangePercent: number | null; postingChangePercent: number | null;
    visualTier: number; visualFillPercent: number; excludedComponents: string[];
    channels: Array<{ id: string; name: string; service: string; availableMetrics: string[]; stats: MetricSummary }>;
    coverage: Record<"exposure" | "engagementRate" | "clicks", { reporting: number; total: number }>;
    engagementRateMethod: string;
  };
};

type Metric = { type: string; value: number; unit: string };
type Aggregate = { metrics: Metric[]; metricsUpdatedAt: string | null };
type Channel = { id: string; name: string; service: string };

function requireExtensionStorage() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) throw new Error("API-key setup is available in the installed Chrome extension.");
}

export async function configureApiKeyStorage() {
  requireExtensionStorage();
  if (chrome.storage.local.setAccessLevel) await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await chrome.storage.local.remove(LEGACY_OAUTH_STORAGE);
}

async function storedApiKey() {
  requireExtensionStorage();
  const result = await chrome.storage.local.get(API_KEY_STORAGE);
  return typeof result[API_KEY_STORAGE] === "string" ? result[API_KEY_STORAGE] as string : null;
}

async function graphQL<T>(apiKey: string, query: string, variables: Record<string, unknown> = {}) {
  let response: Response;
  try {
    response = await fetch(API_URL, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
  } catch {
    throw new Error("Could not reach Buffer. Check your connection and try again.");
  }
  const payload = await response.json().catch(() => ({})) as { data?: T; errors?: Array<{ message?: string }> };
  const apiMessage = payload.errors?.[0]?.message;
  if (response.status === 401 || /unauth|invalid.*(?:key|token)|expired/i.test(apiMessage ?? "")) throw new Error("This Buffer API key is invalid or expired. Create a new key and replace it here.");
  if (!response.ok || payload.errors?.length || !payload.data) {
    throw new Error(apiMessage ? `Buffer says: ${apiMessage}` : "Buffer could not load this account.");
  }
  return payload.data;
}

export async function connectWithApiKey(rawApiKey: string) {
  requireExtensionStorage();
  const apiKey = rawApiKey.trim();
  if (!apiKey) throw new Error("Paste your Buffer API key first.");
  const result = await graphQL<{ account: { organizations: Array<{ id: string; name: string }> } }>(apiKey, `query ValidateApiKey { account { organizations { id name } } }`);
  if (!result.account.organizations.length) throw new Error("This Buffer account does not have an organization yet.");
  await chrome.storage.local.set({ [API_KEY_STORAGE]: apiKey });
}

export async function isBufferConnected() { return Boolean(await storedApiKey()); }
export async function disconnectBuffer() { requireExtensionStorage(); await chrome.storage.local.remove(API_KEY_STORAGE); }

export async function getOrganizations() {
  const apiKey = await storedApiKey();
  if (!apiKey) throw new Error("Paste your Buffer API key to continue.");
  const result = await graphQL<{ account: { organizations: Array<{ id: string; name: string }> } }>(apiKey, `query DashboardOrganizations { account { organizations { id name } } }`);
  return result.account.organizations;
}

export async function getSavedOrganizationId() {
  requireExtensionStorage();
  const result = await chrome.storage.local.get(ORGANIZATION_STORAGE);
  return typeof result[ORGANIZATION_STORAGE] === "string" ? result[ORGANIZATION_STORAGE] as string : null;
}

export async function saveOrganizationId(organizationId: string) {
  requireExtensionStorage();
  await chrome.storage.local.set({ [ORGANIZATION_STORAGE]: organizationId });
}

function mapMetrics(aggregate: Aggregate) {
  const metrics = new Map(aggregate.metrics.map(metric => [metric.type, Number(metric.value)]));
  const exposureTypes = ["reach", "views", "impressions"].filter(type => metrics.has(type));
  const clickTypes = ["clicks", "linkClicks", "link_clicks"].filter(type => metrics.has(type));
  const sumPresent = (types: string[]) => types.length ? types.reduce((sum, type) => sum + (metrics.get(type) ?? 0), 0) : null;
  const interactionTypes = ["reactions", "comments", "reposts", "shares", "saves", ...clickTypes];
  return {
    summary: { posts: metrics.get("postCount") ?? null, likes: metrics.get("reactions") ?? null, comments: metrics.get("comments") ?? null, exposure: sumPresent(exposureTypes), engagementRate: metrics.get("engagementRate") ?? null, clicks: sumPresent(clickTypes) } as MetricSummary,
    available: [...metrics.keys()], interactions: interactionTypes.reduce((sum, type) => sum + (metrics.get(type) ?? 0), 0), exposureComponents: exposureTypes
  };
}

function valuesFor(summaries: MetricSummary[], field: keyof MetricSummary) { return summaries.map(summary => summary[field]).filter((value): value is number => value !== null); }
function sumReported(summaries: MetricSummary[], field: keyof MetricSummary) { const values = valuesFor(summaries, field); return values.length ? values.reduce((sum, value) => sum + value, 0) : null; }
function averageReported(summaries: MetricSummary[], field: keyof MetricSummary) { const values = valuesFor(summaries, field); return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function combineSummaries(summaries: MetricSummary[]): MetricSummary { return { posts: sumReported(summaries, "posts"), likes: sumReported(summaries, "likes"), comments: sumReported(summaries, "comments"), exposure: sumReported(summaries, "exposure"), engagementRate: averageReported(summaries, "engagementRate"), clicks: sumReported(summaries, "clicks") }; }
function percentChange(current: number | null, baseline: number | null) { return current === null || baseline === null || baseline === 0 ? null : (current - baseline) / baseline * 100; }

export async function getDashboardStats(days: number, requestedOrganizationId?: string | null): Promise<DashboardStats> {
  const apiKey = await storedApiKey();
  if (!apiKey) throw new Error("Paste your Buffer API key to continue.");
  const account = await graphQL<{ account: { organizations: Array<{ id: string; name: string }> } }>(apiKey, `query DashboardAccount { account { organizations { id name } } }`);
  const organization = account.account.organizations.find(item => item.id === requestedOrganizationId) ?? account.account.organizations[0];
  if (!organization) throw new Error("This Buffer account does not have an organization yet.");
  const channelResult = await graphQL<{ channels: Channel[] }>(apiKey, `query DashboardChannels($organizationId: OrganizationId!) { channels(input: { organizationId: $organizationId }) { id name service } }`, { organizationId: organization.id });
  const channels = channelResult.channels;
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const baselineEnd = new Date(start.getTime() - 1);
  const baselineStart = new Date(baselineEnd.getTime() - days * 86400000);
  const targets = channels.length ? channels : [{ id: "all", name: "All channels", service: "all" }];
  const definitions: string[] = [], selections: string[] = [];
  const variables: Record<string, unknown> = {};
  targets.forEach((channel, index) => {
    const currentName = `current${index}`;
    definitions.push(`$${currentName}: AggregatedPostMetricsInput!`);
    selections.push(`${currentName}: aggregatedPostMetrics(input: $${currentName}) { metrics { type value unit } metricsUpdatedAt }`);
    const channelIds = channels.length ? { channelIds: [channel.id] } : {};
    variables[currentName] = { organizationId: organization.id, startDateTime: start.toISOString(), endDateTime: end.toISOString(), ...channelIds };
  });
  const aggregates = await graphQL<Record<string, Aggregate>>(apiKey, `query DashboardMetrics(${definitions.join(", ")}) { ${selections.join("\n")} }`, variables);
  const currentMapped = targets.map((_, index) => mapMetrics(aggregates[`current${index}`]));
  // Buffer Free limits Insights to 31 days. Do not fetch a preceding comparison
  // period, which would make a 30-day dashboard request reach 60 days back.
  const emptyAggregate: Aggregate = { metrics: [], metricsUpdatedAt: null };
  const baselineMapped = targets.map(() => mapMetrics(emptyAggregate));
  const stats = combineSummaries(currentMapped.map(item => item.summary));
  const baseline = combineSummaries(baselineMapped.map(item => item.summary));
  const currentInteractions = currentMapped.reduce((sum, item) => sum + item.interactions, 0), baselineInteractions = baselineMapped.reduce((sum, item) => sum + item.interactions, 0);
  const freshness = targets.map((_, index) => aggregates[`current${index}`].metricsUpdatedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const reporting = (field: "exposure" | "engagementRate" | "clicks") => currentMapped.filter(item => item.summary[field] !== null).length;
  const exposureComponents = [...new Set(currentMapped.flatMap(item => item.exposureComponents))];
  return {
    organization, window: { startDateTime: start.toISOString(), endDateTime: end.toISOString() }, metricsUpdatedAt: freshness, stats, exposureTimeline: [],
    dev: {
      baselineWindow: { startDateTime: baselineStart.toISOString(), endDateTime: baselineEnd.toISOString() }, baseline, components: exposureComponents,
      currentInteractions, baselineInteractions, gain: currentInteractions - baselineInteractions, progressRatio: baselineInteractions ? currentInteractions / baselineInteractions : null,
      engagementChangePercent: percentChange(stats.engagementRate, baseline.engagementRate), postingChangePercent: percentChange(stats.posts, baseline.posts),
      visualTier: stats.exposure === null ? 0 : stats.exposure >= 1000 ? 3 : stats.exposure >= 100 ? 2 : 1, visualFillPercent: stats.exposure === null ? 0 : Math.min(100, stats.exposure / 10),
      excludedComponents: ["reach", "views", "impressions"].filter(type => !exposureComponents.includes(type)),
      channels: targets.map((channel, index) => ({ ...channel, availableMetrics: currentMapped[index].available, stats: currentMapped[index].summary })),
      coverage: { exposure: { reporting: reporting("exposure"), total: targets.length }, engagementRate: { reporting: reporting("engagementRate"), total: targets.length }, clicks: { reporting: reporting("clicks"), total: targets.length } },
      engagementRateMethod: "Average of reporting channel engagement rates"
    }
  };
}
