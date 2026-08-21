// Seed the content-os database with Bishir's brand, niche, and idea bank.
// Uses the engine directly — no CLI.
import { connect } from '@content-os/core';

const db = connect();

function setSetting(key, value) {
  const existing = db.prepare('SELECT key FROM settings WHERE key = ?').get(key);
  if (existing) {
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(JSON.stringify(value), key);
  } else {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
  }
  console.log(`  ${key} ✓`);
}

console.log('=== Setting up Bishir / Codeket ===\n');

// --- Brand ---
console.log('Brand:');
setSetting('brand', {
  name: 'Bishir',
  company: 'Codeket',
  tagline: 'Custom software and AI that actually works',
  tone: ['practical', 'educational', 'direct', 'technical', 'operational', 'entertaining'],
  voice: 'Show real builds, not theory. Save-worthy content that makes people think "I need this for my business."',
  position: 'Full-stack engineer and founder who builds production systems, not demos.',
});

// --- Pillars ---
console.log('Pillars:');
setSetting('pillars', [
  'workflow-automation',
  'custom-software',
  'ai-implementation',
  'customer-acquisition',
  'business-operations',
]);

// --- Pillar details ---
console.log('Pillar details:');
setSetting('pillar_details', {
  'workflow-automation': {
    description: 'Automating repetitive business processes with software',
    example_topics: ['automating invoice processing', 'lead follow-up automation', 'inventory sync across platforms', 'automated reporting dashboards'],
    platforms: ['tiktok', 'youtube', 'linkedin'],
  },
  'custom-software': {
    description: 'Building bespoke software solutions for specific business problems',
    example_topics: ['CRM from scratch', 'booking system for service businesses', 'internal tools that replace 5 SaaS subscriptions', 'client portals'],
    platforms: ['youtube', 'linkedin', 'tiktok'],
  },
  'ai-implementation': {
    description: 'Real AI integration into business workflows (not hype)',
    example_topics: ['AI customer support that actually works', 'document processing with AI', 'AI-powered lead scoring', 'chatbot vs custom AI agent'],
    platforms: ['tiktok', 'youtube', 'instagram', 'linkedin'],
  },
  'customer-acquisition': {
    description: 'Software systems that bring in and convert customers',
    example_topics: ['automated lead generation pipeline', 'landing page that converts', 'CRM setup for follow-ups', 'WhatsApp automation for sales'],
    platforms: ['tiktok', 'instagram', 'linkedin'],
  },
  'business-operations': {
    description: 'Systems and tools that make businesses run smoother',
    example_topics: ['replacing 10 SaaS tools with one custom app', 'real-time business dashboard', 'automated inventory management', 'client onboarding automation'],
    platforms: ['youtube', 'linkedin', 'tiktok'],
  },
});

// --- Audience ---
console.log('Audience:');
setSetting('target_audience', {
  primary: 'Business owners, founders, and entrepreneurs',
  secondary: 'Professionals and operations managers',
  pain_points: [
    'Wasting time on repetitive manual tasks',
    'Paying for 10+ SaaS tools that dont talk to each other',
    'Losing leads because follow-up is manual',
    'No visibility into business performance',
    'Hiring developers who dont understand the business',
  ],
  desire: 'Automate the boring stuff, get a system that actually works, scale without hiring more people',
  level: 'Intermediate — they know their business, they want tech solutions, not tech lectures',
});

// --- Platforms ---
console.log('Platforms:');
setSetting('platforms', {
  tiktok: { cadence: '5x/week', format: 'short-form (15-60s)', focus: 'quick wins, before/after automations, tool demos' },
  youtube: { cadence: '2x/week', format: 'long-form (5-15min)', focus: 'full builds, tutorials, system walkthroughs' },
  instagram: { cadence: '3x/week', format: 'reels + stories', focus: 'visual before/after, results, behind-the-scenes' },
  linkedin: { cadence: '3x/week', format: 'text + short video', focus: 'case studies, business insights, technical deep dives' },
  x: { cadence: 'daily', format: 'threads + short takes', focus: 'hot takes, quick tips, engaging conversations' },
});

// --- Hook preferences ---
console.log('Hooks:');
setSetting('hooks_preferred', [
  'problem_statement',
  'contrarian',
  'question',
  'stat',
  'story',
]);

// --- Scoring weights ---
console.log('Weights:');
setSetting('content_weights', {
  pillarRelevance: 25,
  audienceInterest: 20,
  trendPotential: 15,
  authorityFit: 15,
  engagementPotential: 10,
  businessValue: 10,
  novelty: 5,
});

// NOTE: no idea bank is seeded. Ideas are generated FRESH by the agent each
// cycle (from brand knowledge, trends, and audience input) and registered
// via engine.addIdeas([...]) — the same way production always shoots fresh
// footage instead of recutting old videos.

// --- Summary ---
const count = db.prepare('SELECT COUNT(*) as n FROM content_items').get();
console.log(`\nTotal items in DB: ${count.n}`);

const settings = db.prepare('SELECT key FROM settings ORDER BY key').all();
console.log(`Settings: ${settings.map(s => s.key).join(', ')}`);

db.close();
console.log('\n=== Done ===');
