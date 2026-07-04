// Research mode: starting from just a brand URL, auto-discover the prompts
// customers actually ask AI in that category and the competitors AI consistently
// recommends. Falls back to deterministic stubs when LLM keys are
// missing so the demo still produces a coherent dashboard.

import * as cheerio from 'cheerio';

import { config } from '@/lib/config';
import { generateJson, generateText } from '@/lib/llm';
import type {
  AnalysisResult,
  CrawlSignals,
  DiscoveredCompetitor,
  Issue,
  ResearchFindings,
} from '@/lib/types';

const PPLX_URL = 'https://api.perplexity.ai/chat/completions';

function domainOf(input: string): string {
  try {
    return new URL(input).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return input.replace(/^www\./, '').toLowerCase();
  }
}

interface BrandSummary {
  domain: string;
  title: string;
  description: string;
  rawText: string;
}

async function fetchBrandSummary(url: string): Promise<BrandSummary> {
  const domain = domainOf(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': config.userAgent, accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) return { domain, title: domain, description: '', rawText: '' };
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html') && !ct.includes('xml')) {
      return { domain, title: domain, description: '', rawText: '' };
    }
    const html = await res.text();
    const $ = cheerio.load(html);
    const title = ($('title').first().text() || $('h1').first().text() || domain).trim();
    const description = (
      $('meta[name="description"]').attr('content') ??
      $('meta[property="og:description"]').attr('content') ??
      ''
    ).trim();
    const rawText = $('body').text().replace(/\s+/g, ' ').slice(0, 2000).trim();
    return { domain, title, description, rawText };
  } catch {
    return { domain, title: domain, description: '', rawText: '' };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Brand summary + category + prompts ──────────────────────────────────────

interface SummarizeOutput {
  category: string;
  summary: string;
  prompts: string[];
}

// Category keyword → category-level prompt templates.
// These fire when LLM is unavailable to ensure prompts are category-level.
// Prompts are generalised (no narrow multi-brand comparisons) and sized to
// match the breadth of queries each category attracts.
const CATEGORY_PROMPT_TEMPLATES: { match: RegExp; category: string; prompts: string[] }[] = [
  // ─── Online Shopping / Marketplace ────────────────────────────────────────
  {
    match: /\b(amazon|shop|shopping|marketplace|buy|retail|online store|cart|checkout|merchant|shopee|lazada|aliexpress|taobao|ebay|walmart|target|etsy)\b/i,
    category: 'Online shopping platform',
    prompts: [
      'What is the best online shopping platform for reliability and product variety in 2025?',
      'Which online marketplace offers the strongest buyer protection and refund policy?',
      'How do online shopping platforms compare on delivery speed and shipping costs?',
      'What are the hidden costs of shopping on major online marketplaces?',
      'Which platform is best for international shopping with low import fees?',
      'How do online marketplaces handle counterfeit products and seller quality control?',
      'What is the safest way to shop online and avoid scams in 2025?',
      'Which online shopping platform has the best loyalty program and rewards?',
    ],
  },
  // ─── Food Delivery ────────────────────────────────────────────────────────
  {
    match: /\b(food\s?delivery|foodpanda|deliveroo|doordash|uber\s?eats|grubhub|takeout|takeaway|meal\s?delivery|grabfood)\b/i,
    category: 'Food delivery platform',
    prompts: [
      'What is the most reliable food delivery app for consistent quality in 2025?',
      'Which food delivery platform has the lowest fees and best value for customers?',
      'How do food delivery apps compare on restaurant selection and availability?',
      'What are the real costs of ordering food delivery versus cooking at home?',
      'Which food delivery service is best for healthy and dietary-specific meal options?',
      'How do food delivery platforms treat their drivers and restaurants fairly?',
      'What is the fastest food delivery app for orders under 30 minutes?',
    ],
  },
  // ─── Ride-Hailing / Transport ─────────────────────────────────────────────
  {
    match: /\b(ride|taxi|transport|grab|uber|lyft|gojek|bolt|ride-?hail|car\s?booking|driver)\b/i,
    category: 'Ride-hailing and transport platform',
    prompts: [
      'What is the safest and most reliable ride-hailing app in 2025?',
      'How do ride-hailing apps compare on pricing transparency and surge pricing?',
      'Which ride-hailing platform has the best coverage in suburban and rural areas?',
      'Are ride-hailing services actually cheaper than owning a car in major cities?',
      'How do ride-hailing companies compare on driver safety features and vetting?',
      'What is the best ride-hailing app for airport transfers and long-distance trips?',
      'Which transport platform offers the best subscription or membership pricing?',
    ],
  },
  // ─── Video Streaming ──────────────────────────────────────────────────────
  {
    match: /\b(youtube|netflix|hulu|disney.?plus|video\s?streaming|stream.*(?:movie|show|series)|watch.*(?:movie|show|series)|creator|broadcast|live\s?stream|vod|ott)\b/i,
    category: 'Video streaming platform',
    prompts: [
      'What is the best video streaming service for overall content quality in 2025?',
      'Which streaming platform offers the best value for money across all content types?',
      'How do streaming services compare on original content production and quality?',
      'What is the best free streaming option with a good content library?',
      'Which streaming platform is best for families with children?',
      'How do streaming platforms compare on video quality and offline download features?',
      'Is subscribing to multiple streaming services still worth it or is bundling better?',
      'Which streaming service has the best interface and content discovery algorithm?',
    ],
  },
  // ─── Music Streaming ────────────────────────────────────────────────────────
  {
    match: /\b(music|spotify|apple music|audio|listen|playlist|podcast|song|album|hi-?fi|tidal)\b/i,
    category: 'Music streaming service',
    prompts: [
      'What is the best music streaming service for audio quality and library size in 2025?',
      'Which music platform has the best algorithm for discovering new artists?',
      'How do music streaming services compare on artist compensation and fairness?',
      'What is the best free music streaming option without too many ads?',
      'Which music streaming service is best for podcast and audiobook listeners?',
      'How do music platforms compare on family plans and multi-device support?',
      'Is lossless audio streaming actually worth paying extra for?',
    ],
  },
  // ─── Social Media ─────────────────────────────────────────────────────────
  {
    match: /\b(social\s?media|instagram|facebook|twitter|tiktok|snapchat|feed|follow|reel|story|influencer)\b/i,
    category: 'Social media platform',
    prompts: [
      'What is the best social media platform for building an audience organically in 2025?',
      'Which social media platform is safest for privacy and personal data?',
      'How do social platforms compare on content reach without paid promotion?',
      'What is the best social media platform for small business marketing on a budget?',
      'Which platform is best for video content creators starting from scratch?',
      'How do social media algorithms decide what content to promote or suppress?',
      'Is it still possible to go viral organically without paying for ads?',
      'What are the mental health risks of different social media platforms?',
    ],
  },
  // ─── AI Assistant / Chatbot ───────────────────────────────────────────────
  {
    match: /\b(ai|chatgpt|openai|claude|gemini|artificial intelligence|llm|chatbot|copilot|generative)\b/i,
    category: 'AI assistant and chatbot',
    prompts: [
      'What is the best AI chatbot for everyday productivity tasks in 2025?',
      'Which AI assistant gives the most accurate and well-sourced answers?',
      'How do AI chatbots compare on coding assistance and technical problem-solving?',
      'What is the best free AI tool that does not require a paid subscription?',
      'Which AI assistant is best for creative writing and brainstorming?',
      'How do AI tools compare on data privacy and what they do with conversations?',
      'Is paying for premium AI subscriptions worth it over the free versions?',
      'Which AI chatbot handles complex multi-step reasoning best?',
    ],
  },
  // ─── Digital Payment / E-Wallet ───────────────────────────────────────────
  {
    match: /\b(payment|paypal|stripe|fintech|digital wallet|ewallet|transfer|venmo|wise|gcash|touch.?n.?go)\b/i,
    category: 'Digital payment platform',
    prompts: [
      'What is the best digital payment platform for international money transfers in 2025?',
      'Which payment app has the lowest transaction and currency conversion fees?',
      'How do digital wallets compare on security and fraud protection?',
      'What is the most widely accepted digital payment method globally?',
      'Which payment platform is best for freelancers receiving international payments?',
      'How do payment platforms compare on speed of transfer and fund availability?',
      'What are the hidden fees that digital payment services charge?',
    ],
  },
  // ─── Online Learning ──────────────────────────────────────────────────────
  {
    match: /\b(education|learn|course|udemy|coursera|tutorial|training|lms|e-?learning|certification)\b/i,
    category: 'Online learning platform',
    prompts: [
      'What is the best online learning platform for career advancement in 2025?',
      'Which online course certifications are actually valued by employers?',
      'How do online learning platforms compare on content quality and teaching methods?',
      'What is the best platform for learning programming and technical skills?',
      'Which online education platform offers the best value for self-paced learners?',
      'How do online courses compare to traditional degrees in terms of career outcomes?',
      'What is the best platform for learning business and entrepreneurship skills?',
    ],
  },
  // ─── Messaging App ────────────────────────────────────────────────────────
  {
    match: /\b(messaging|chat|whatsapp|telegram|signal|messenger|wechat|line|imessage|dm)\b/i,
    category: 'Messaging app',
    prompts: [
      'What is the most secure messaging app for privacy-conscious users in 2025?',
      'Which messaging platform is best for large group conversations and communities?',
      'How do messaging apps compare on end-to-end encryption and metadata collection?',
      'What is the best messaging app for business and team communication?',
      'Which messaging platform works best across all devices and operating systems?',
      'How do messaging apps handle data requests from governments?',
      'Is it worth switching from mainstream messaging apps to privacy-focused alternatives?',
    ],
  },
  // ─── Video Conferencing ───────────────────────────────────────────────────
  {
    match: /\b(video\s?call|conference|zoom|teams|meet|webinar|meeting)\b/i,
    category: 'Video conferencing platform',
    prompts: [
      'What is the best video conferencing tool for remote teams in 2025?',
      'Which video meeting platform has the most reliable audio and video quality?',
      'How do video conferencing tools compare on pricing for growing teams?',
      'What is the best platform for hosting large webinars and virtual events?',
      'Which video call tool has the best recording and transcription features?',
      'How do conferencing platforms compare on integration with other work tools?',
      'What are the biggest security risks with popular video conferencing apps?',
    ],
  },
  // ─── VPN / Privacy ────────────────────────────────────────────────────────
  {
    match: /\b(vpn|nordvpn|expressvpn|surfshark|proton|private browsing|anonymous)\b/i,
    category: 'VPN service',
    prompts: [
      'What is the best VPN for speed, privacy, and streaming access in 2025?',
      'Which VPN provider has been independently verified as genuinely no-log?',
      'How do VPN services compare on connection speed and global server coverage?',
      'Is paying for a VPN necessary for everyday internet users?',
      'Which VPN is best for bypassing geo-restrictions on streaming content?',
      'How do VPN providers compare on transparency and security audit history?',
      'What is the best VPN for privacy without sacrificing internet speed?',
    ],
  },
  // ─── Travel Booking ───────────────────────────────────────────────────────
  {
    match: /\b(travel|booking|flight|hotel|airbnb|expedia|agoda|trip|vacation|airline|hostel)\b/i,
    category: 'Travel booking platform',
    prompts: [
      'What is the best platform for finding genuinely cheap flights in 2025?',
      'Which travel booking site has the most transparent pricing with no hidden fees?',
      'How do travel platforms compare on cancellation flexibility and refund policies?',
      'Is booking directly with hotels or airlines actually cheaper than using aggregators?',
      'What is the best platform for planning international multi-city trips?',
      'Which travel booking site is best for last-minute deals and spontaneous trips?',
      'How do accommodation platforms compare on verified reviews and photo accuracy?',
      'What hidden charges do travel booking platforms add that most users miss?',
    ],
  },
  // ─── Gaming Platform ──────────────────────────────────────────────────────
  {
    match: /\b(gaming|game|steam|epic|xbox|playstation|nintendo|gamer|esport|console)\b/i,
    category: 'Gaming platform',
    prompts: [
      'What is the best gaming platform for overall value and game library in 2025?',
      'Which game subscription service offers the best catalogue of titles?',
      'How do gaming platforms compare on revenue share and support for indie developers?',
      'Is cloud gaming ready to replace traditional console and PC gaming?',
      'Which platform has the best online multiplayer infrastructure and community?',
      'How do gaming storefronts compare on sales, discounts, and free game offerings?',
      'What is the best gaming platform for someone new to gaming?',
    ],
  },
  // ─── Ecommerce Store Builder ──────────────────────────────────────────────
  {
    match: /\b(shopify|woocommerce|bigcommerce|squarespace|sell online|online store|dropship|store builder)\b/i,
    category: 'Ecommerce store builder',
    prompts: [
      'What is the best ecommerce platform for starting an online store in 2025?',
      'Which ecommerce builder has the lowest total cost including transaction fees?',
      'How do ecommerce platforms compare on ease of setup for non-technical users?',
      'What is the best platform for selling internationally with multi-currency support?',
      'Which ecommerce platform scales best from startup to enterprise?',
      'How do store builders compare on SEO capabilities and marketing tools?',
      'What are the real limitations merchants discover after committing to a platform?',
    ],
  },
  // ─── Cloud Hosting ────────────────────────────────────────────────────────
  {
    match: /\b(cloud|hosting|server|deploy|aws|azure|gcp|devops|kubernetes|container)\b/i,
    category: 'Cloud hosting platform',
    prompts: [
      'What is the best cloud hosting provider for web applications in 2025?',
      'Which cloud platform has the most predictable and transparent pricing?',
      'How do cloud providers compare on performance for different workload types?',
      'What is the best hosting platform for startups that need to scale quickly?',
      'Which cloud provider has the best developer experience and documentation?',
      'How do modern deployment platforms compare for serverless and edge computing?',
      'What are the real cost surprises teams encounter after committing to a cloud provider?',
      'Which cloud platform is best for AI and machine learning workloads?',
    ],
  },
  // ─── Project Management ───────────────────────────────────────────────────
  {
    match: /\b(project\s?management|task|kanban|sprint|issue|planning|agile|jira|asana|trello)\b/i,
    category: 'Project management tool',
    prompts: [
      'What is the best project management tool for software engineering teams in 2025?',
      'Which project management platform is simplest for non-technical teams to adopt?',
      'How do project management tools compare on pricing as team size grows?',
      'What is the best tool for agile workflows and sprint planning?',
      'Which project management platform has the best integrations with developer tools?',
      'How do task management tools compare on speed, design, and user experience?',
      'What are the most common complaints teams have about popular project tools?',
      'Which project management tool is best for remote and distributed teams?',
    ],
  },
  // ─── CRM ──────────────────────────────────────────────────────────────────
  {
    match: /\b(crm|salesforce|hubspot|sales|pipeline|customer relationship|lead|deal)\b/i,
    category: 'CRM platform',
    prompts: [
      'What is the best CRM for growing B2B sales teams in 2025?',
      'Which CRM platform offers the best value without requiring consultants to set up?',
      'How do CRM tools compare on sales automation and pipeline management?',
      'What is the best CRM for small businesses with limited budget?',
      'Which CRM has the best reporting, analytics, and forecasting features?',
      'How do CRM platforms compare on email integration and communication tracking?',
      'What are the hidden costs of enterprise CRM platforms that teams discover later?',
    ],
  },
  // ─── Email Marketing ──────────────────────────────────────────────────────
  {
    match: /\b(email\s?marketing|newsletter|mailchimp|klaviyo|campaign|drip|email\s?automation)\b/i,
    category: 'Email marketing platform',
    prompts: [
      'What is the best email marketing platform for ecommerce businesses in 2025?',
      'Which email tool has the best deliverability rates and inbox placement?',
      'How do email marketing platforms compare as subscriber lists grow past 10K?',
      'What is the best platform for automated email sequences and drip campaigns?',
      'Which email marketing tool has the best segmentation and personalisation?',
      'How do email platforms compare on template design and ease of use?',
      'Is email marketing still more effective than social media for driving sales?',
    ],
  },
  // ─── Design Tool ──────────────────────────────────────────────────────────
  {
    match: /\b(design|figma|canva|sketch|ui|ux|prototype|graphic|illustration|wireframe)\b/i,
    category: 'Design tool',
    prompts: [
      'What is the best design tool for product and UI teams in 2025?',
      'Which design platform is best for real-time collaboration with remote teams?',
      'How do design tools compare on prototyping and developer handoff workflow?',
      'What is the best design tool for non-designers who need professional results?',
      'Which platform is best for building and maintaining a design system?',
      'How do design tools compare on performance with large and complex files?',
      'Is there a viable free alternative to paid design tools for startups?',
    ],
  },
  // ─── Digital Banking / Neobank ────────────────────────────────────────────
  {
    match: /\b(bank|banking|neobank|revolut|wise|monzo|n26|savings|account|digital bank)\b/i,
    category: 'Digital banking platform',
    prompts: [
      'What is the best digital bank for everyday use and international travel in 2025?',
      'Which neobank has the best currency exchange rates and fee transparency?',
      'How do digital banks compare on security, deposit insurance, and fund protection?',
      'Is switching from a traditional bank to a neobank safe and practical?',
      'Which digital bank is best for freelancers and small business owners?',
      'How do neobanks compare on savings interest rates and investment features?',
      'What are the limitations of digital-only banks that customers discover after switching?',
    ],
  },
  // ─── Note-Taking / Productivity ───────────────────────────────────────────
  {
    match: /\b(note|notes|notion|obsidian|evernote|productivity|workspace|wiki|knowledge\s?base)\b/i,
    category: 'Note-taking and productivity app',
    prompts: [
      'What is the best note-taking app for personal knowledge management in 2025?',
      'Which productivity app is best for building a connected second brain system?',
      'How do note-taking apps compare on offline access, speed, and data ownership?',
      'What is the best workspace tool for teams that need docs, wikis, and projects?',
      'Which note app is best for long-term information storage and retrieval?',
      'How do productivity tools compare on search quality across large note collections?',
      'Is it worth paying for premium note-taking tools or are free options sufficient?',
    ],
  },
  // ─── Fitness App ──────────────────────────────────────────────────────────
  {
    match: /\b(fitness|workout|gym|exercise|peloton|strava|health|wellness|yoga|wearable|tracker)\b/i,
    category: 'Fitness and workout app',
    prompts: [
      'What is the best fitness app for structured workout programs in 2025?',
      'Which fitness platform actually helps users stay consistent long-term?',
      'How do fitness apps compare on workout personalisation and adaptive programming?',
      'What is the best fitness app for home workouts without equipment?',
      'Which fitness tracker or app provides the most accurate health data?',
      'How do fitness app subscriptions compare in value to a gym membership?',
      'What is the best app for combining strength training and cardio tracking?',
    ],
  },
  // ─── News ─────────────────────────────────────────────────────────────────
  {
    match: /\b(news|journalism|bbc|cnn|reuters|newspaper|magazine|editorial|press)\b/i,
    category: 'News platform',
    prompts: [
      'What is the most trustworthy news source for balanced global reporting in 2025?',
      'Which news platform provides the least biased coverage of current events?',
      'How do news outlets compare on investigative journalism quality and depth?',
      'Is paying for a news subscription worth it when free sources exist?',
      'Which news platform is best for understanding complex geopolitical issues?',
      'How do news aggregators compare on source diversity and filter bubble risk?',
      'What is the best way to stay informed without information overload?',
    ],
  },
  // ─── Cloud Storage ────────────────────────────────────────────────────────
  {
    match: /\b(storage|drive|backup|sync|cloud storage|dropbox|onedrive|google drive|icloud)\b/i,
    category: 'Cloud storage service',
    prompts: [
      'What is the best cloud storage service for personal and team use in 2025?',
      'Which cloud storage platform has the strongest encryption and privacy protections?',
      'How do cloud storage services compare on free tier limits and upgrade pricing?',
      'What is the best cloud storage for seamless collaboration across teams?',
      'Which cloud storage works best across multiple devices and operating systems?',
      'How do cloud backup services compare on reliability and data recovery?',
      'What are the real costs after the free tier on major cloud storage platforms?',
    ],
  },
  // ─── Search Engine ────────────────────────────────────────────────────────
  {
    match: /\b(search|google|bing|duckduckgo|engine|browse|web search|brave search)\b/i,
    category: 'Search engine',
    prompts: [
      'What is the best search engine for privacy without sacrificing result quality?',
      'Which search engine gives the most relevant and unbiased results in 2025?',
      'How do search engines compare on AI-powered answers and source accuracy?',
      'What is the best search engine for academic research and deep information needs?',
      'Which search engines genuinely do not track user data or build ad profiles?',
      'How do alternative search engines compare to the dominant market leader?',
      'What is the best search engine for finding local businesses and services?',
    ],
  },
  // ─── Food / Restaurant (alternate match) ──────────────────────────────────
  {
    match: /\b(food|restaurant|order|meal|takeout|grocery|dine|eat)\b/i,
    category: 'Food delivery platform',
    prompts: [
      'What is the best food delivery app for restaurant variety and reliability in 2025?',
      'Which food delivery platform offers the best value with lowest markups?',
      'How do food delivery services compare on speed and order accuracy?',
      'What is the best platform for ordering groceries online with fast delivery?',
      'Which food delivery app has the best deals and subscription savings?',
      'How do food delivery platforms compare on supporting local restaurants fairly?',
      'Is food delivery worth the convenience cost over cooking or dining out?',
    ],
  },
];

function detectCategory(signal: string): string | null {
  const lower = signal.toLowerCase();
  for (const entry of CATEGORY_PROMPT_TEMPLATES) {
    if (entry.match.test(lower)) {
      return entry.category;
    }
  }
  return null;
}

function buildFallbackPrompts(brandName: string, categorySignal: string): string[] {
  const signal = categorySignal.toLowerCase();

  // Try to match a known category
  for (const entry of CATEGORY_PROMPT_TEMPLATES) {
    if (entry.match.test(signal)) {
      return entry.prompts;
    }
  }

  // Generic category-level prompts derived from the description
  const shortCategory = categorySignal.length > 50
    ? categorySignal.slice(0, 50).replace(/[^a-zA-Z0-9\s/-]/g, '').trim()
    : categorySignal.replace(/[^a-zA-Z0-9\s/-]/g, '').trim();

  const cap = shortCategory.charAt(0).toUpperCase() + shortCategory.slice(1);

  return [
    `What is the best ${shortCategory} available in 2025?`,
    `How do the top ${shortCategory} platforms compare on features and pricing?`,
    `Which ${shortCategory} is best suited for growing teams and businesses?`,
    `What are the biggest drawbacks of popular ${shortCategory} solutions?`,
    `${cap} — comprehensive comparison of leading options and alternatives`,
  ];
}

async function summarizeAndDiscoverPrompts(
  brand: BrandSummary,
  hint?: string,
): Promise<SummarizeOutput> {
  // Infer category from description/title for the fallback
  // Combine domain + title + description for better category matching
  const inferredCategory = hint || brand.description.slice(0, 80) || brand.title.slice(0, 80) || 'B2B software';
  const brandName = brand.domain.split('.')[0];

  // Use all available signals for category detection (domain, title, description, hint)
  const allSignals = `${brand.domain} ${brandName} ${brand.title} ${brand.description} ${hint || ''}`;

  // Build category-level fallback prompts using all signals
  const fallback: SummarizeOutput = {
    category: detectCategory(allSignals) || inferredCategory,
    summary: brand.description || `Brand at ${brand.domain}.`,
    prompts: buildFallbackPrompts(brandName, allSignals),
  };

  const result = await generateJson<SummarizeOutput>(
    [
      `You're researching a brand for AI-visibility analysis.`,
      `Brand domain: ${brand.domain}`,
      `Page title: ${brand.title}`,
      `Meta description: ${brand.description || '(none)'}`,
      hint ? `User hint about the brand: ${hint}` : '',
      ``,
      `Page text (truncated):`,
      brand.rawText.slice(0, 1500),
      ``,
      `Produce three things:`,
      `1. category — a short phrase identifying the product category (e.g. "video streaming platform", "B2B project management software", "DTC men's skincare", "AI-powered coding assistant"). This should describe the MARKET the brand operates in, not the brand itself.`,
      `2. summary — one tight sentence describing what this brand does and who it's for.`,
      `3. prompts — 7 to 8 distinct high-intent prompts that a potential buyer/user would ask an AI engine (ChatGPT, Perplexity, etc.) when researching this CATEGORY of product/service. These should be generalised, critical, evaluative queries — NOT narrow "Brand A vs Brand B vs Brand C" comparisons. At most 1 of them may mention the brand name. The rest must be category-level. Make them varied:`,
      `   - "What is the best [category] for [specific use case] in 2025?"`,
      `   - "How do [category] platforms compare on [important criterion]?"`,
      `   - "Is [category] worth paying for when free alternatives exist?"`,
      `   - "Which [category] has the best [critical feature] globally?"`,
      `   - "What are the real limitations of popular [category] platforms?"`,
      `   - "What hidden costs do [category] services have?"`,
      `   - "Which [category] is best for [specific audience or use case]?"`,
      ``,
      `FORMATTING: Each prompt must start with a capital letter and be a complete, formal sentence or question.`,
      `VARIETY: Include a mix of value-judgment queries, feature-specific queries, cost/pricing queries, and critical/challenging queries. Do NOT use narrow multi-brand "A vs B vs C vs D" comparisons — keep comparisons generalised.`,
      `Think GLOBALLY — include major worldwide perspectives, not just niche ones.`,
      `Think CRITICALLY — include prompts that challenge the value proposition.`,
      ``,
      `BAD prompts (too narrow, listing specific brands): "Amazon vs Shopee vs Lazada vs AliExpress — which is cheapest?", "Spotify vs Apple Music vs Tidal — best value?"`,
      `GOOD prompts (generalised, category-level): "What is the best online shopping platform for reliability in 2025?", "Which music streaming service has the best discovery algorithm?", "Is paying for premium streaming worth it over free tiers?"`,
    ].join('\n'),
    `Return JSON with this exact shape:\n{"category": "...", "summary": "...", "prompts": ["...", "...", "...", "...", "...", "...", "..."]}`,
  );

  if (
    result &&
    typeof result.category === 'string' &&
    typeof result.summary === 'string' &&
    Array.isArray(result.prompts) &&
    result.prompts.length >= 3
  ) {
    return {
      category: result.category,
      summary: result.summary,
      prompts: result.prompts.slice(0, 8).map((p) => String(p).trim()).filter(Boolean),
    };
  }
  return fallback;
}

// ─── Competitor discovery ────────────────────────────────────────────────────

interface PplxResp {
  search_results?: { url?: string; title?: string }[];
  citations?: (string | { url?: string; title?: string })[];
}

interface PromptCitations {
  prompt: string;
  domains: { domain: string; url: string; title?: string }[];
}

async function pplxOnePrompt(apiKey: string, prompt: string): Promise<PromptCitations | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(PPLX_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.perplexityModel,
        messages: [{ role: 'user', content: prompt }],
        return_citations: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as PplxResp;
    const out: PromptCitations = { prompt, domains: [] };
    const push = (url: string, title?: string) => {
      const d = domainOf(url);
      if (!d) return;
      out.domains.push({ domain: d, url, title });
    };
    if (Array.isArray(data.search_results)) {
      for (const r of data.search_results) if (r?.url) push(r.url, r.title);
    }
    if (out.domains.length === 0 && Array.isArray(data.citations)) {
      for (const c of data.citations) {
        if (typeof c === 'string') push(c);
        else if (c?.url) push(c.url, c.title);
      }
    }
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const IGNORE_DOMAINS = new Set([
  'wikipedia.org',
  'reddit.com',
  'youtube.com',
  'youtu.be',
  'medium.com',
  'quora.com',
  'forbes.com',
  'techcrunch.com',
  'g2.com',
  'capterra.com',
  'trustpilot.com',
  'producthunt.com',
  'gartner.com',
  'crunchbase.com',
  'linkedin.com',
  'github.com',
  'stackoverflow.com',
]);

const FALLBACK_COMPETITORS_BY_CATEGORY: {
  match: RegExp;
  competitors: { domain: string; url: string; sampleTitle: string }[];
}[] = [
  {
    match:
      /\b(youtube|video|videos|streaming|creator|creators|content sharing|short-form|livestream|live streaming|music events)\b/i,
    competitors: [
      {
        domain: 'netflix.com',
        url: 'https://www.netflix.com',
        sampleTitle: 'Netflix — global streaming entertainment service',
      },
      {
        domain: 'disneyplus.com',
        url: 'https://www.disneyplus.com',
        sampleTitle: 'Disney+ — streaming movies, series, and originals',
      },
      {
        domain: 'tiktok.com',
        url: 'https://www.tiktok.com',
        sampleTitle: 'TikTok — short-form video platform with 1B+ users',
      },
      {
        domain: 'twitch.tv',
        url: 'https://www.twitch.tv',
        sampleTitle: 'Twitch — live streaming platform for gaming and creators',
      },
      {
        domain: 'vimeo.com',
        url: 'https://vimeo.com',
        sampleTitle: 'Vimeo — professional video hosting and tools for businesses',
      },
    ],
  },
  {
    match: /\b(project|task|work management|workspace|sprint|issue tracker|planning)\b/i,
    competitors: [
      {
        domain: 'atlassian.com',
        url: 'https://www.atlassian.com/software/jira',
        sampleTitle: 'Jira — the industry standard for issue tracking',
      },
      {
        domain: 'notion.so',
        url: 'https://www.notion.so',
        sampleTitle: 'Notion — all-in-one workspace used by 30M+ people',
      },
      {
        domain: 'asana.com',
        url: 'https://asana.com',
        sampleTitle: 'Asana — enterprise work management platform',
      },
      {
        domain: 'monday.com',
        url: 'https://monday.com',
        sampleTitle: 'monday.com — work OS for teams of all sizes',
      },
      {
        domain: 'clickup.com',
        url: 'https://clickup.com',
        sampleTitle: 'ClickUp — all-in-one productivity platform',
      },
    ],
  },
  {
    match: /\b(crm|sales|pipeline|customer relationship)\b/i,
    competitors: [
      {
        domain: 'salesforce.com',
        url: 'https://www.salesforce.com',
        sampleTitle: 'Salesforce — world\'s #1 CRM platform',
      },
      {
        domain: 'hubspot.com',
        url: 'https://www.hubspot.com',
        sampleTitle: 'HubSpot — CRM platform with 200K+ customers globally',
      },
      {
        domain: 'zoho.com',
        url: 'https://www.zoho.com/crm',
        sampleTitle: 'Zoho CRM — affordable enterprise CRM',
      },
      {
        domain: 'pipedrive.com',
        url: 'https://www.pipedrive.com',
        sampleTitle: 'Pipedrive — sales-focused CRM for growing teams',
      },
    ],
  },
  {
    match: /\b(email|newsletter|marketing automation|campaign)\b/i,
    competitors: [
      {
        domain: 'mailchimp.com',
        url: 'https://mailchimp.com',
        sampleTitle: 'Mailchimp — the world\'s largest email marketing platform',
      },
      {
        domain: 'klaviyo.com',
        url: 'https://www.klaviyo.com',
        sampleTitle: 'Klaviyo — revenue-driving marketing automation',
      },
      {
        domain: 'hubspot.com',
        url: 'https://www.hubspot.com/products/marketing/email',
        sampleTitle: 'HubSpot Email — enterprise marketing automation',
      },
      {
        domain: 'brevo.com',
        url: 'https://www.brevo.com',
        sampleTitle: 'Brevo (Sendinblue) — all-in-one marketing platform',
      },
    ],
  },
  {
    match: /\b(amazon|shop|shopping|marketplace|buy|retail|online store|aliexpress|shopee|lazada|taobao)\b/i,
    competitors: [
      { domain: 'amazon.com', url: 'https://www.amazon.com', sampleTitle: 'Amazon — global online marketplace' },
      { domain: 'shopee.com', url: 'https://shopee.com', sampleTitle: 'Shopee — leading ecommerce platform in Southeast Asia' },
      { domain: 'lazada.com', url: 'https://www.lazada.com', sampleTitle: 'Lazada — ecommerce platform in Southeast Asia' },
      { domain: 'aliexpress.com', url: 'https://www.aliexpress.com', sampleTitle: 'AliExpress — global online retail from China' },
      { domain: 'ebay.com', url: 'https://www.ebay.com', sampleTitle: 'eBay — global online auction and shopping' },
    ],
  },
  {
    match: /\b(food\s?delivery|foodpanda|deliveroo|doordash|uber\s?eats|grubhub|grabfood)\b/i,
    competitors: [
      { domain: 'grab.com', url: 'https://www.grab.com', sampleTitle: 'GrabFood — food delivery across Southeast Asia' },
      { domain: 'foodpanda.com', url: 'https://www.foodpanda.com', sampleTitle: 'Foodpanda — food delivery in Asia and Europe' },
      { domain: 'doordash.com', url: 'https://www.doordash.com', sampleTitle: 'DoorDash — food delivery leader in the US' },
      { domain: 'uber.com', url: 'https://www.ubereats.com', sampleTitle: 'Uber Eats — global food delivery' },
      { domain: 'deliveroo.com', url: 'https://deliveroo.com', sampleTitle: 'Deliveroo — premium food delivery in UK and Europe' },
    ],
  },
  {
    match: /\b(ride|taxi|transport|grab|uber|lyft|gojek|bolt|ride-?hail)\b/i,
    competitors: [
      { domain: 'grab.com', url: 'https://www.grab.com', sampleTitle: 'Grab — ride-hailing and super-app in Southeast Asia' },
      { domain: 'uber.com', url: 'https://www.uber.com', sampleTitle: 'Uber — global ride-hailing platform' },
      { domain: 'bolt.eu', url: 'https://bolt.eu', sampleTitle: 'Bolt — ride-hailing in Europe and Africa' },
      { domain: 'gojek.com', url: 'https://www.gojek.com', sampleTitle: 'Gojek — Indonesian super-app for rides and services' },
      { domain: 'lyft.com', url: 'https://www.lyft.com', sampleTitle: 'Lyft — ride-hailing in the US and Canada' },
    ],
  },
];

const PROMPT_BRANDS: Record<string, { domain: string; url: string; sampleTitle: string }> = {
  // Video & Streaming
  netflix: { domain: 'netflix.com', url: 'https://www.netflix.com', sampleTitle: 'Netflix — global streaming entertainment service' },
  disney: { domain: 'disneyplus.com', url: 'https://www.disneyplus.com', sampleTitle: 'Disney+ — streaming movies, series, and originals' },
  hulu: { domain: 'hulu.com', url: 'https://www.hulu.com', sampleTitle: 'Hulu — streaming TV, movies, and live TV' },
  vimeo: { domain: 'vimeo.com', url: 'https://vimeo.com', sampleTitle: 'Vimeo — professional video hosting' },
  tiktok: { domain: 'tiktok.com', url: 'https://www.tiktok.com', sampleTitle: 'TikTok — short-form video platform' },
  twitch: { domain: 'twitch.tv', url: 'https://www.twitch.tv', sampleTitle: 'Twitch — live streaming for gaming and creators' },
  // Project Management
  notion: { domain: 'notion.so', url: 'https://www.notion.so', sampleTitle: 'Notion — all-in-one workspace' },
  asana: { domain: 'asana.com', url: 'https://asana.com', sampleTitle: 'Asana — work management for teams' },
  monday: { domain: 'monday.com', url: 'https://monday.com', sampleTitle: 'monday.com — work OS' },
  jira: { domain: 'atlassian.com', url: 'https://www.atlassian.com/software/jira', sampleTitle: 'Jira — issue and project tracking' },
  trello: { domain: 'trello.com', url: 'https://trello.com', sampleTitle: 'Trello — visual project management' },
  linear: { domain: 'linear.app', url: 'https://linear.app', sampleTitle: 'Linear — modern issue tracking' },
  clickup: { domain: 'clickup.com', url: 'https://clickup.com', sampleTitle: 'ClickUp — all-in-one productivity' },
  // CRM & Sales
  salesforce: { domain: 'salesforce.com', url: 'https://www.salesforce.com', sampleTitle: 'Salesforce — enterprise CRM' },
  hubspot: { domain: 'hubspot.com', url: 'https://www.hubspot.com', sampleTitle: 'HubSpot — CRM and marketing' },
  pipedrive: { domain: 'pipedrive.com', url: 'https://www.pipedrive.com', sampleTitle: 'Pipedrive — sales CRM' },
  zoho: { domain: 'zoho.com', url: 'https://www.zoho.com', sampleTitle: 'Zoho — business software suite' },
  // Email & Marketing
  mailchimp: { domain: 'mailchimp.com', url: 'https://mailchimp.com', sampleTitle: 'Mailchimp — email marketing platform' },
  klaviyo: { domain: 'klaviyo.com', url: 'https://www.klaviyo.com', sampleTitle: 'Klaviyo — ecommerce marketing' },
  // Design
  figma: { domain: 'figma.com', url: 'https://www.figma.com', sampleTitle: 'Figma — collaborative design tool' },
  canva: { domain: 'canva.com', url: 'https://www.canva.com', sampleTitle: 'Canva — graphic design for everyone' },
  // Ecommerce
  shopify: { domain: 'shopify.com', url: 'https://www.shopify.com', sampleTitle: 'Shopify — ecommerce platform' },
  // Cloud
  aws: { domain: 'aws.amazon.com', url: 'https://aws.amazon.com', sampleTitle: 'AWS — cloud computing services' },
  vercel: { domain: 'vercel.com', url: 'https://vercel.com', sampleTitle: 'Vercel — frontend cloud platform' },
  // Music
  spotify: { domain: 'spotify.com', url: 'https://www.spotify.com', sampleTitle: 'Spotify — music streaming service' },
  // AI
  openai: { domain: 'openai.com', url: 'https://openai.com', sampleTitle: 'OpenAI — AI research and products' },
  anthropic: { domain: 'anthropic.com', url: 'https://www.anthropic.com', sampleTitle: 'Anthropic — AI safety company' },
  // Social
  instagram: { domain: 'instagram.com', url: 'https://www.instagram.com', sampleTitle: 'Instagram — photo and video sharing' },
  linkedin: { domain: 'linkedin.com', url: 'https://www.linkedin.com', sampleTitle: 'LinkedIn — professional network' },
};

const DOMAIN_COMPETITOR_FALLBACKS: {
  match: RegExp;
  competitors: { domain: string; url: string; sampleTitle: string }[];
}[] = [
  {
    match: /\b(youtube\.com|youtu\.be|netflix\.com|disneyplus\.com|hulu\.com|primevideo\.com)\b/i,
    competitors: FALLBACK_COMPETITORS_BY_CATEGORY[0].competitors,
  },
  {
    match: /\b(vimeo\.com|tiktok\.com|twitch\.tv|dailymotion\.com)\b/i,
    competitors: FALLBACK_COMPETITORS_BY_CATEGORY[0].competitors,
  },
  {
    match: /\b(notion\.so|asana\.com|monday\.com|linear\.app|atlassian\.com|trello\.com|clickup\.com)\b/i,
    competitors: FALLBACK_COMPETITORS_BY_CATEGORY[1].competitors,
  },
  {
    match: /\b(salesforce\.com|hubspot\.com|zoho\.com|pipedrive\.com)\b/i,
    competitors: FALLBACK_COMPETITORS_BY_CATEGORY[2].competitors,
  },
  {
    match: /\b(mailchimp\.com|klaviyo\.com|constantcontact\.com|brevo\.com|sendgrid\.com)\b/i,
    competitors: FALLBACK_COMPETITORS_BY_CATEGORY[3].competitors,
  },
];

function fallbackCompetitors(
  prompts: string[],
  brandDomain: string,
  category: string,
  brandTitle = '',
  summary = '',
): DiscoveredCompetitor[] {
  const promptText = prompts.join(' ').toLowerCase();
  const signalText = `${brandDomain} ${brandTitle} ${category} ${summary} ${promptText}`.toLowerCase();
  const byDomain = new Map<
    string,
    { domain: string; url: string; sampleTitle: string; promptHits: number }
  >();

  // Robust self-exclusion: matches exact domain, subdomain variants, and same brand name
  const brandBase = brandDomain.split('.')[0]; // e.g. "amazon" from "amazon.com" or "amazon.sg"
  const isSelf = (compDomain: string): boolean => {
    if (compDomain === brandDomain) return true;
    // Same base name (amazon.com vs amazon.sg vs aws.amazon.com)
    if (compDomain.includes(brandBase) || brandDomain.includes(compDomain.split('.')[0])) return true;
    // Subdomain of brand (e.g. aws.amazon.com when brand is amazon.com)
    if (compDomain.endsWith(`.${brandDomain}`)) return true;
    return false;
  };

  for (const [brand, competitor] of Object.entries(PROMPT_BRANDS)) {
    if (!signalText.includes(brand)) continue;
    if (isSelf(competitor.domain)) continue;
    byDomain.set(competitor.domain, {
      ...competitor,
      promptHits: prompts.filter((prompt) => prompt.toLowerCase().includes(brand)).length,
    });
  }

  const domainMatch = DOMAIN_COMPETITOR_FALLBACKS.find((entry) => entry.match.test(signalText));
  for (const competitor of domainMatch?.competitors ?? []) {
    if (isSelf(competitor.domain) || byDomain.has(competitor.domain)) continue;
    byDomain.set(competitor.domain, {
      ...competitor,
      promptHits: 0,
    });
  }

  const categoryMatch = FALLBACK_COMPETITORS_BY_CATEGORY.find((entry) =>
    entry.match.test(signalText),
  );
  for (const competitor of categoryMatch?.competitors ?? []) {
    if (isSelf(competitor.domain) || byDomain.has(competitor.domain)) continue;
    byDomain.set(competitor.domain, {
      ...competitor,
      promptHits: 0,
    });
  }

  if (byDomain.size === 0) {
    for (const competitor of FALLBACK_COMPETITORS_BY_CATEGORY[1].competitors) {
      if (isSelf(competitor.domain) || byDomain.has(competitor.domain)) continue;
      byDomain.set(competitor.domain, {
        ...competitor,
        promptHits: 0,
      });
    }
  }

  return Array.from(byDomain.values())
    .map((competitor, index) => ({
      domain: competitor.domain,
      url: competitor.url,
      citationCount: Math.max(1, prompts.length - index - (competitor.promptHits > 0 ? 0 : 1)),
      promptCount: prompts.length,
      sampleTitle: competitor.sampleTitle,
    }))
    .sort((a, b) => b.citationCount - a.citationCount)
    .slice(0, 5);
}

interface LlmCompetitor {
  domain: string;
  url: string;
  citationCount?: number;
  sampleTitle?: string;
}

interface LlmCompetitorOutput {
  competitors: LlmCompetitor[];
}

function normalizeCompetitorUrl(domain: string, url: unknown): string {
  if (typeof url === 'string') {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
    } catch {
      // Fall through to domain URL.
    }
  }
  return `https://${domain}`;
}

async function discoverCompetitorsViaLlm(
  brand: BrandSummary,
  category: string,
  summary: string,
  prompts: string[],
): Promise<DiscoveredCompetitor[] | null> {
  const result = await generateJson<LlmCompetitorOutput>(
    [
      `You're choosing realistic competitors for an AI-visibility analysis.`,
      `Use your general market knowledge and the supplied prompts. Do not default to project-management brands unless this is actually a project-management category.`,
      ``,
      `Brand domain: ${brand.domain}`,
      `Brand title: ${brand.title}`,
      `Brand summary: ${summary}`,
      `Category: ${category}`,
      ``,
      `Customer prompts we will test:`,
      prompts.map((prompt, i) => `${i + 1}. ${prompt}`).join('\n'),
      ``,
      `Return 3-5 direct competitors or close substitutes that an AI answer engine would plausibly mention for these prompts.`,
      `Think GLOBALLY — include the biggest worldwide players in this space, not just niche alternatives.`,
      `For example: if the brand is a video platform, include Netflix, Disney+, TikTok — not just Dailymotion.`,
      `Exclude the brand domain itself and broad publisher/community/reference domains.`,
      `citationCount should be an estimated count from 1 to ${prompts.length} for how many of these prompts would plausibly mention that competitor.`,
    ].join('\n'),
    `{"competitors":[{"domain":"example.com","url":"https://example.com","citationCount":3,"sampleTitle":"Example — short description"}]}`,
  );

  if (!result || !Array.isArray(result.competitors)) return null;

  const seen = new Set<string>();
  const brandBase = brand.domain.split('.')[0];
  const competitors: DiscoveredCompetitor[] = [];
  for (const item of result.competitors) {
    if (!item || typeof item.domain !== 'string') continue;
    const domain = domainOf(item.domain);
    if (!domain || IGNORE_DOMAINS.has(domain) || seen.has(domain)) continue;
    // Robust self-exclusion
    if (domain === brand.domain || domain.includes(brandBase) || domain.endsWith(`.${brand.domain}`)) continue;
    seen.add(domain);
    const citationCount =
      typeof item.citationCount === 'number'
        ? Math.min(prompts.length, Math.max(1, Math.round(item.citationCount)))
        : Math.max(1, prompts.length - competitors.length - 1);
    competitors.push({
      domain,
      url: normalizeCompetitorUrl(domain, item.url),
      citationCount,
      promptCount: prompts.length,
      sampleTitle: typeof item.sampleTitle === 'string' ? item.sampleTitle : undefined,
    });
  }

  return competitors
    .sort((a, b) => b.citationCount - a.citationCount)
    .slice(0, 5);
}

async function discoverCompetitorsViaPerplexity(
  prompts: string[],
  brandDomain: string,
): Promise<{ competitors: DiscoveredCompetitor[]; prompts: PromptCitations[] }> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return {
      competitors: [],
      prompts: [],
    };
  }

  const results = await Promise.all(prompts.map((p) => pplxOnePrompt(apiKey, p)));
  const valid = results.filter((r): r is PromptCitations => r !== null);

  // Aggregate by domain. Count how many distinct prompts cite each domain.
  const byDomain = new Map<
    string,
    { count: number; url: string; title?: string }
  >();
  for (const r of valid) {
    const seen = new Set<string>();
    for (const d of r.domains) {
      if (seen.has(d.domain)) continue;
      seen.add(d.domain);
      if (d.domain === brandDomain) continue;
      if (IGNORE_DOMAINS.has(d.domain)) continue;
      const cur = byDomain.get(d.domain);
      if (cur) cur.count += 1;
      else byDomain.set(d.domain, { count: 1, url: d.url, title: d.title });
    }
  }

  const competitors: DiscoveredCompetitor[] = Array.from(byDomain.entries())
    .map(([domain, v]) => ({
      domain,
      url: v.url,
      citationCount: v.count,
      promptCount: prompts.length,
      sampleTitle: v.title,
    }))
    .sort((a, b) => b.citationCount - a.citationCount)
    .slice(0, 5);

  return { competitors, prompts: valid };
}

// ─── Narrative synthesis ─────────────────────────────────────────────────────

async function synthesizeNarrative(
  brand: BrandSummary,
  category: string,
  selectedCompetitor: string,
  discoveredCompetitors: DiscoveredCompetitor[],
  signals: { brand: CrawlSignals; competitor: CrawlSignals },
  analysis: Pick<AnalysisResult, 'score' | 'scoreBreakdown' | 'issues' | 'citations'>,
): Promise<string> {
  // Requirement 3: structured narrative — all issues reflected, no word cap
  const brandCited = analysis.citations.filter(c => c.brandCitedCount > 0).length;
  const compCited = analysis.citations.filter(c => c.competitorCitedCount > 0).length;

  const narrativePrompt = [
    `You are writing an AI visibility research report for a brand. Be specific, cite numbers, and provide actionable recommendations tailored to this brand's specific situation.`,
    ``,
    `Brand: ${brand.domain} — ${brand.description || brand.title}`,
    `Category: ${category}`,
    `Score: ${analysis.score}/100`,
    `Top competitor: ${selectedCompetitor}`,
    `Brand cited in: ${brandCited}/${analysis.citations.length} prompts`,
    `Competitor cited in: ${compCited}/${analysis.citations.length} prompts`,
    ``,
    `Competitors discovered:`,
    discoveredCompetitors.map((c) => `- ${c.domain} (cited ${c.citationCount}/${c.promptCount})`).join('\n'),
    ``,
    `ALL diagnosed issues (reflect every single one in the report):`,
    analysis.issues.map((i) => `- [${i.severity}] ${i.title}: ${i.why}`).join('\n'),
    ``,
    `Crawl signals — brand vs competitor:`,
    `- Title: "${signals.brand.h1Text}" (${signals.brand.titleLength} chars, keyword: ${signals.brand.titleHasKeyword ? 'yes' : 'no'}) vs competitor (${signals.competitor.titleLength} chars, keyword: ${signals.competitor.titleHasKeyword ? 'yes' : 'no'})`,
    `- Comparison page: ${signals.brand.hasComparisonPage ? 'yes' : 'no'} vs ${signals.competitor.hasComparisonPage ? 'yes' : 'no'}`,
    `- Pricing: ${signals.brand.pricingClarity} vs ${signals.competitor.pricingClarity}`,
    `- JSON-LD: [${signals.brand.jsonLdTypes.join(', ') || 'none'}] vs [${signals.competitor.jsonLdTypes.join(', ') || 'none'}]`,
    `- Evidence mentions: ${signals.brand.evidenceCount} vs ${signals.competitor.evidenceCount}`,
    `- Trust signals: ${signals.brand.trustSignals.join(', ') || 'none'} vs ${signals.competitor.trustSignals.join(', ') || 'none'}`,
    `- Word count: ${signals.brand.wordCount} vs ${signals.competitor.wordCount}`,
    `- Internal links: ${signals.brand.internalLinkCount} vs ${signals.competitor.internalLinkCount}`,
    `- Images with alt text: ${signals.brand.imagesWithAlt}/${signals.brand.imagesTotal} vs ${signals.competitor.imagesWithAlt}/${signals.competitor.imagesTotal}`,
    `- Readability: ${signals.brand.readabilityScore}/100 vs ${signals.competitor.readabilityScore}/100`,
    `- Mobile: ${signals.brand.hasViewportMeta ? 'yes' : 'no'} vs ${signals.competitor.hasViewportMeta ? 'yes' : 'no'}`,
    `- Last updated: ${signals.brand.lastUpdated ?? 'unknown'} vs ${signals.competitor.lastUpdated ?? 'unknown'}`,
    ``,
    `Write the report with these sections using Markdown (## headings, - bullets, **bold**):`,
    ``,
    `## Overview`,
    `2-3 sentences: the brand's AI visibility situation, how they compare, and what it means practically.`,
    ``,
    `## Critical issues`,
    `For EVERY diagnosed issue above, write a concise bullet explaining:`,
    `- What the gap is (with specific numbers)`,
    `- Why it matters for AI citation`,
    `Group by severity (high first, then medium, then low). Be thorough — cover ALL issues.`,
    ``,
    `## Recommended actions`,
    `One specific, actionable recommendation per critical issue. Be concrete — what exactly to do and why it will help.`,
    ``,
    `RULES:`,
    `- Include the top 4 high-severity issues, top 3 medium, and top 2 low — not every single one.`,
    `- Be concise per point — one tight sentence per bullet.`,
    `- Recommended actions: max 5, focused on the highest-impact fixes.`,
    `- Be specific to this brand and category — no generic advice.`,
    `- Cite actual numbers from the data above.`,
    `- Do NOT suggest adding an FAQ page.`,
    `- Write in a professional, direct tone.`,
  ].join('\n');

  const llmResult = await generateText(narrativePrompt);

  // No word cap — just use the LLM result if available
  if (llmResult && llmResult.length > 50) {
    return llmResult;
  }

  // Fallback: build narrative from all diagnosed issues
  return buildFallbackNarrative(brand, selectedCompetitor, signals, analysis);
}

function buildFallbackNarrative(
  brand: BrandSummary,
  selectedCompetitor: string,
  signals: { brand: CrawlSignals; competitor: CrawlSignals },
  analysis: Pick<AnalysisResult, 'score' | 'scoreBreakdown' | 'issues' | 'citations'>,
): string {
  const brandCitedCount = analysis.citations.filter(c => c.brandCitedCount > 0).length;
  const compCitedCount = analysis.citations.filter(c => c.competitorCitedCount > 0).length;
  const totalPrompts = analysis.citations.length;
  const brandPct = totalPrompts > 0 ? Math.round((brandCitedCount / totalPrompts) * 100) : 0;
  const compPct = totalPrompts > 0 ? Math.round((compCitedCount / totalPrompts) * 100) : 0;

  // Headline
  const headline = analysis.score < 34
    ? `**${brand.domain}** is nearly invisible to AI answer engines — ${selectedCompetitor} appears in ${compPct}% of tested prompts while you appear in only ${brandPct}%.`
    : analysis.score < 67
      ? `**${brand.domain}** has significant visibility gaps compared to ${selectedCompetitor} — AI engines cite your competitor ${compPct}% of the time vs your ${brandPct}%.`
      : `**${brand.domain}** has a reasonable AI presence but ${selectedCompetitor} still outperforms you on structural signals that determine citation priority.`;

  // Build issues section — cap per severity for conciseness
  const highIssues = analysis.issues.filter(i => i.severity === 'high').slice(0, 4);
  const mediumIssues = analysis.issues.filter(i => i.severity === 'medium').slice(0, 3);
  const lowIssues = analysis.issues.filter(i => i.severity === 'low').slice(0, 2);

  const issueLines: string[] = [];

  if (highIssues.length > 0) {
    issueLines.push('**Critical (high severity):**');
    for (const issue of highIssues) {
      issueLines.push(`- **${issue.title}** — ${issue.why}`);
    }
  }
  if (mediumIssues.length > 0) {
    issueLines.push('');
    issueLines.push('**Important (medium severity):**');
    for (const issue of mediumIssues) {
      issueLines.push(`- **${issue.title}** — ${issue.why}`);
    }
  }
  if (lowIssues.length > 0) {
    issueLines.push('');
    issueLines.push('**Minor (low severity):**');
    for (const issue of lowIssues) {
      issueLines.push(`- **${issue.title}** — ${issue.why}`);
    }
  }

  // Build recommendations — top 5 most impactful
  const recs: string[] = [];
  let recNum = 1;
  const topIssues = [...highIssues, ...mediumIssues].slice(0, 5);
  for (const issue of topIssues) {
    const rec = issueToRecommendation(issue, brand.domain, selectedCompetitor, signals);
    if (rec) {
      recs.push(`${recNum}. ${rec}`);
      recNum++;
    }
  }

  return [
    `## Overview`,
    headline,
    ``,
    `## Critical issues`,
    ...issueLines,
    ``,
    `## Recommended actions`,
    ...(recs.length > 0 ? recs : ['- Address the issues listed above to improve your AI visibility score.']),
  ].join('\n');
}

function issueToRecommendation(
  issue: Issue,
  brandDomain: string,
  competitor: string,
  signals: { brand: CrawlSignals; competitor: CrawlSignals },
): string | null {
  const t = issue.title.toLowerCase();

  if (t.includes('title') && t.includes('keyword')) {
    return `**Rewrite your page title** to include your product category and primary value prop. Example: "[Brand] — [Category] for [Target User]" instead of a generic title.`;
  }
  if (t.includes('title') && (t.includes('short') || t.includes('vague'))) {
    return `**Expand your title** to 30-65 characters with specific keywords. A descriptive title helps AI engines match your page to relevant queries.`;
  }
  if (t.includes('title') && t.includes('long')) {
    return `**Trim your title** to under 65 characters. Front-load the most important keywords so they aren't cut off.`;
  }
  if (t.includes('not cited') || t.includes('citation rate')) {
    return `**Create answer-optimized content** for each prompt where you're absent. Lead with a direct 1-sentence answer, follow with evidence. AI engines extract the first sentence.`;
  }
  if (t.includes('hard to read') || t.includes('sentences')) {
    return `**Simplify your writing** — break long sentences into short, quotable statements. AI engines extract concise sentences; aim for under 20 words per sentence.`;
  }
  if (t.includes('mobile')) {
    return `**Add a viewport meta tag** and ensure responsive design. Over 60% of AI queries originate from mobile, and non-responsive pages get deprioritized.`;
  }
  if (t.includes('images') && t.includes('slow')) {
    return `**Optimize images** — compress, lazy-load, and reduce total image count. Fast-loading pages rank higher in AI citation priority.`;
  }
  if (t.includes('image-to-text') || t.includes('thin content')) {
    return `**Add more substantive text** to balance images. AI engines need extractable text — aim for 500+ words of informative content per key page.`;
  }
  if (t.includes('internal link')) {
    return `**Add internal links** to related content pages. Link to your features, comparison, pricing, and case study pages — AI engines use link structure to gauge authority.`;
  }
  if (t.includes('alt text') || t.includes('alt description')) {
    return `**Add descriptive alt text** to all images. This improves accessibility and helps AI understand visual content on your page.`;
  }
  if (t.includes('competitor') && t.includes('stronger')) {
    return `**Close the content quality gap** — ${competitor} outperforms on multiple signals. Match their depth of evidence, trust signals, and content structure to compete for citations.`;
  }
  if (t.includes('competitor') && t.includes('advantage')) {
    return `**Target the specific area** where ${competitor} leads. Match their advantage and you'll compete for the same AI citations.`;
  }
  if (t.includes('genuinely useful') || t.includes('quality concern')) {
    return `**Improve content substance** — ensure depth (500+ words), concrete evidence, clear structure (single H1), and readable writing. AI engines reward genuinely helpful content.`;
  }
  if (t.includes('meta description') && t.includes('no ')) {
    return `**Add a meta description** (120-160 chars) with your key value prop. AI engines and search results use this as a page summary.`;
  }
  if (t.includes('meta description') && t.includes('short')) {
    return `**Expand your meta description** to 120-160 characters with a clear, compelling summary of what this page offers.`;
  }
  if (t.includes('comparison') || t.includes('vs')) {
    return `**Publish a comparison page** (e.g., /vs/${competitor}) with a side-by-side table. AI engines answer "X vs Y" queries directly from these pages.`;
  }
  if (t.includes('pricing') && t.includes('no ')) {
    return `**Make pricing visible** with concrete dollar amounts. Users ask AI about pricing — if your numbers aren't extractable, the competitor's will be cited instead.`;
  }
  if (t.includes('pricing') && t.includes('vague')) {
    return `**Add specific pricing numbers** (e.g., "$X/mo") rather than vague tier names. AI engines cite exact figures.`;
  }
  if (t.includes('trust signal')) {
    return `**Add trust indicators**: named testimonials, case study results, press mentions, compliance badges, and review platform scores. AI confidence in citing you increases with each signal.`;
  }
  if (t.includes('date') || t.includes('stale') || t.includes('year old')) {
    return `**Update your content** and display a visible last-updated timestamp. AI engines deprioritize undated or stale pages — freshness is a citation factor.`;
  }
  if (t.includes('json-ld') || t.includes('structured data')) {
    return `**Add JSON-LD schema** (Product, Organization, Article) to your page head. This makes your content machine-readable for AI parsers.`;
  }
  if (t.includes('product') && t.includes('organization') && t.includes('schema')) {
    return `**Add Product and Organization JSON-LD** so AI engines can identify what you sell and who you are programmatically.`;
  }
  if (t.includes('content-type schema') || t.includes('howto')) {
    return `**Add Article or HowTo JSON-LD** to help AI engines identify your instructional/informational content for extraction.`;
  }
  if (t.includes('evidence') || t.includes('data point') || t.includes('stats')) {
    return `**Add concrete numbers** to your pages: customer metrics, benchmark results, growth stats, case study outcomes. AI engines prefer citing pages with hard evidence.`;
  }
  if (t.includes('shallow') || t.includes('thin')) {
    return `**Expand page content** to 500+ words minimum with substantive information. Include specifics that AI engines can quote as authoritative answers.`;
  }

  // Generic fallback
  return `**Fix: ${issue.title}** — ${issue.why.split('.')[0]}.`;
}

// ─── Public entry points ─────────────────────────────────────────────────────

export interface ResearchDiscovery {
  brand: BrandSummary;
  category: string;
  summary: string;
  prompts: string[];
  competitors: DiscoveredCompetitor[];
}

/** Step 1: discover prompts + competitors from just a brand URL. */
export async function discover(brandUrl: string, hint?: string): Promise<ResearchDiscovery> {
  const brand = await fetchBrandSummary(brandUrl);
  const { category, summary, prompts } = await summarizeAndDiscoverPrompts(brand, hint);
  const llmCompetitors = await discoverCompetitorsViaLlm(brand, category, summary, prompts);
  const competitors =
    llmCompetitors && llmCompetitors.length > 0
      ? llmCompetitors
      : (await discoverCompetitorsViaPerplexity(prompts, brand.domain)).competitors;

  return {
    brand,
    category,
    summary,
    prompts,
    competitors:
      competitors.length > 0
        ? competitors
        : fallbackCompetitors(prompts, brand.domain, category, brand.title, summary),
  };
}

/** Step 2: given a finished analysis, build the narrative findings report. */
export async function synthesizeFindings(
  discovery: ResearchDiscovery,
  selectedCompetitorDomain: string,
  signals: { brand: CrawlSignals; competitor: CrawlSignals },
  analysis: Pick<AnalysisResult, 'score' | 'scoreBreakdown' | 'issues' | 'citations'>,
): Promise<ResearchFindings> {
  const narrative = await synthesizeNarrative(
    discovery.brand,
    discovery.category,
    selectedCompetitorDomain,
    discovery.competitors,
    signals,
    analysis,
  );
  return {
    brandSummary: discovery.summary,
    category: discovery.category,
    discoveredPrompts: discovery.prompts,
    discoveredCompetitors: discovery.competitors,
    selectedCompetitorDomain,
    narrative,
    source: 'auto',
  };
}
