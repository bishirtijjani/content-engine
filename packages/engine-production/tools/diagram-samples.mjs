// tools/diagram-samples.mjs — neutral sample specs for every layout.
// Shared by the catalog generator and the tests. No item content.

/** A neutral placeholder "screenshot" — never a real screen or past work. */
export const PLACEHOLDER_SHOT = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200">' +
  '<rect width="900" height="1200" fill="#0B1220"/>' +
  '<rect x="60" y="70" width="360" height="34" rx="10" fill="#F59E0B"/>' +
  '<rect x="60" y="140" width="780" height="10" rx="5" fill="rgba(255,255,255,.18)"/>' +
  '<rect x="60" y="170" width="640" height="10" rx="5" fill="rgba(255,255,255,.12)"/>' +
  '<rect x="60" y="240" width="780" height="300" rx="18" fill="#0f4c81"/>' +
  '<rect x="60" y="580" width="780" height="10" rx="5" fill="rgba(255,255,255,.18)"/>' +
  '<rect x="60" y="610" width="700" height="10" rx="5" fill="rgba(255,255,255,.12)"/>' +
  '<rect x="60" y="640" width="740" height="10" rx="5" fill="rgba(255,255,255,.12)"/>' +
  '<rect x="60" y="720" width="240" height="60" rx="30" fill="#EA580C"/>' +
  '</svg>',
).toString('base64');

/** Neutral sample content per layout. No item data, no brand claims. */
export const SAMPLES = {
  flow: {
    title: 'A process title', active: 1,
    steps: [
      { label: 'First step in the process', icon: 'circle-check' },
      { label: 'Second step in the process', icon: 'settings' },
      { label: 'Third step in the process', icon: 'bolt' },
      { label: 'Fourth step in the process', icon: 'flag' },
    ],
  },
  pipeline: {
    title: 'A pipeline title', progress: 1,
    steps: [
      { label: 'First stage', icon: 'circle-dot' },
      { label: 'Second stage', icon: 'settings' },
      { label: 'Third stage', icon: 'bolt' },
    ],
  },
  cycle: {
    title: 'A cycle title', center: 'The loop', active: 2,
    steps: [
      { label: 'Plan', icon: 'clipboard' },
      { label: 'Build', icon: 'hammer' },
      { label: 'Ship', icon: 'rocket' },
      { label: 'Learn', icon: 'chart-line' },
    ],
  },
  timeline: {
    title: 'A timeline title', active: 1,
    events: [
      { date: 'Q1', label: 'First event', icon: 'flag' },
      { date: 'Q2', label: 'Second event', icon: 'flag' },
      { date: 'Q3', label: 'Third event', icon: 'flag' },
    ],
  },
  funnel: {
    title: 'A funnel title',
    stages: [
      { label: 'Visitors', value: '1,000' },
      { label: 'Leads', value: '120' },
      { label: 'Customers', value: '20' },
    ],
  },
  'before-after': {
    title: 'A before and after title',
    before: { label: 'Before', points: ['Manual work', 'Slow', 'Errors'] },
    after: { label: 'After', points: ['Automated', 'Fast', 'Verified'] },
  },
  comparison: {
    title: 'A comparison title', highlight: 1,
    columns: [
      { label: 'Option A', points: ['First point', 'Second point'] },
      { label: 'Option B', points: ['First point', 'Second point'] },
      { label: 'Option C', points: ['First point'] },
    ],
  },
  decision: {
    title: 'A decision title', question: 'Should this be automated?',
    yesLabel: 'Yes', noLabel: 'No',
    yes: { label: 'Automate it', points: ['Rules', 'Schedule'] },
    no: { label: 'Leave it', points: ['Manual'] },
  },
  hierarchy: {
    title: 'A hierarchy title', root: 'The root node',
    levels: [
      [{ label: 'Level one, node A', icon: 'users' }, { label: 'Level one, node B', icon: 'users' }],
      [{ label: 'Level two A' }, { label: 'Level two B' }, { label: 'Level two C' }],
    ],
  },
  architecture: {
    title: 'An architecture title',
    nodes: [
      { id: 'app', label: 'The client', icon: 'device-laptop' },
      { id: 'api', label: 'The service', icon: 'api' },
      { id: 'db', label: 'The database', icon: 'database' },
      { id: 'queue', label: 'The queue', icon: 'stack-2' },
    ],
    links: [
      { from: 'app', to: 'api', label: 'HTTPS' },
      { from: 'api', to: 'db', label: 'SQL' },
      { from: 'api', to: 'queue', label: 'events', dashed: true },
    ],
  },
  relationship: {
    title: 'A relationship title', hub: 'The hub',
    nodes: [
      { label: 'Node one', icon: 'user' },
      { label: 'Node two', icon: 'receipt' },
      { label: 'Node three', icon: 'credit-card' },
    ],
    links: [{ to: 0, label: 'relates' }, { to: 1, label: 'relates' }, { to: 2, label: 'relates' }],
  },
  layers: {
    title: 'A layers title',
    layers: [
      { label: 'The top layer', icon: 'layout' },
      { label: 'The middle layer', icon: 'settings' },
      { label: 'The bottom layer', icon: 'database' },
    ],
  },

  table: {
    title: 'A table title',
    columns: ['Item', 'Amount', 'Status'],
    rows: [
      ['Item one', '1,200', 'Paid'],
      ['Item two', '840', 'Pending'],
      ['Item three', '320', 'Paid'],
      ['Item four', '90', 'Failed'],
    ],
    highlightRow: 1,
  },
  'line-chart': {
    title: 'A trend title',
    x: { labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'] },
    series: [
      { label: 'Series one', values: [12, 18, 15, 24, 30, 28] },
      { label: 'Series two', values: [8, 10, 14, 16, 20, 25] },
    ],
    valueLabels: true,
  },
  'area-chart': {
    title: 'A trend title',
    x: { labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'] },
    series: [{ label: 'Series one', values: [12, 18, 15, 24, 30, 28] }],
    valueLabels: true,
  },
  scatter: {
    title: 'A scatter title',
    x: { label: 'Effort' },
    y: { label: 'Impact' },
    points: [
      { label: 'One', x: 2, y: 8 },
      { label: 'Two', x: 5, y: 6 },
      { label: 'Three', x: 8, y: 9 },
      { label: 'Four', x: 4, y: 3 },
      { label: 'Five', x: 7, y: 4 },
    ],
  },
  pie: {
    title: 'A pie title',
    donut: true,
    center: '100%',
    slices: [
      { label: 'Slice one', value: 42 },
      { label: 'Slice two', value: 28 },
      { label: 'Slice three', value: 18 },
      { label: 'Slice four', value: 12 },
    ],
  },
  'stacked-bars': {
    title: 'A stacked bars title',
    categories: ['Cat one', 'Cat two', 'Cat three', 'Cat four'],
    series: [
      { label: 'Series one', values: [4, 6, 3, 5] },
      { label: 'Series two', values: [2, 3, 4, 2] },
      { label: 'Series three', values: [1, 2, 2, 3] },
    ],
  },
  waterfall: {
    title: 'A waterfall title',
    items: [
      { label: 'Start', value: 100, type: 'start' },
      { label: 'Add', value: 40 },
      { label: 'Lose', value: -25 },
      { label: 'Add', value: 15 },
      { label: 'Total', type: 'total' },
    ],
  },
  sankey: {
    title: 'A sankey title',
    nodes: [
      { id: 'a', label: 'Source' },
      { id: 'b', label: 'Path A' },
      { id: 'c', label: 'Path B' },
      { id: 'd', label: 'Result' },
    ],
    links: [
      { from: 'a', to: 'b', value: 60 },
      { from: 'a', to: 'c', value: 40 },
      { from: 'b', to: 'd', value: 50 },
      { from: 'c', to: 'd', value: 30 },
    ],
  },
  heatmap: {
    title: 'A heatmap title',
    rows: ['Row one', 'Row two', 'Row three'],
    cols: ['Col one', 'Col two', 'Col three', 'Col four'],
    values: [
      [2, 5, 8, 4],
      [6, 9, 3, 7],
      [1, 4, 6, 2],
    ],
  },
  gauge: {
    title: 'A gauge title',
    value: 72,
    min: 0,
    max: 100,
    unit: '%',
    label: 'A supporting label',
  },
  ranking: {
    title: 'A ranking title',
    items: [
      { label: 'Item one', value: 92, icon: 'trophy' },
      { label: 'Item two', value: 74, icon: 'medal' },
      { label: 'Item three', value: 58, icon: 'award' },
      { label: 'Item four', value: 31, icon: 'star' },
    ],
  },
  bullet: {
    title: 'A bullet title',
    items: [
      { label: 'Metric one', value: 72, target: 85, max: 100 },
      { label: 'Metric two', value: 48, target: 60, max: 100 },
      { label: 'Metric three', value: 91, target: 80, max: 100 },
    ],
  },
  swimlane: {
    title: 'A swimlane title',
    lanes: [{ label: 'Customer', icon: 'user' }, { label: 'System', icon: 'settings' }],
    steps: [
      { lane: 0, label: 'Send request' },
      { lane: 1, label: 'Validate' },
      { lane: 1, label: 'Process' },
      { lane: 0, label: 'Receive result' },
    ],
  },
  sequence: {
    title: 'A sequence title',
    actors: [{ label: 'User' }, { label: 'App' }, { label: 'Database' }],
    messages: [
      { from: 0, to: 1, label: 'Request' },
      { from: 1, to: 2, label: 'Query' },
      { from: 2, to: 1, label: 'Result', dashed: true },
      { from: 1, to: 0, label: 'Response' },
    ],
  },
  'state-machine': {
    title: 'A state title',
    states: [
      { id: 'draft', label: 'Draft' },
      { id: 'review', label: 'In review' },
      { id: 'live', label: 'Live', tone: 'amber' },
    ],
    transitions: [
      { from: 'draft', to: 'review', label: 'submit' },
      { from: 'review', to: 'live', label: 'approve' },
      { from: 'review', to: 'draft', label: 'reject' },
    ],
  },
  'fork-join': {
    title: 'A fork title',
    start: 'Request',
    branches: [{ label: 'Validate' }, { label: 'Enrich' }, { label: 'Log' }],
    join: 'Respond',
  },
  'approval-chain': {
    title: 'An approval title',
    stages: [
      { label: 'Draft', who: 'Owner', status: 'approved' },
      { label: 'Review', who: 'Editor', status: 'approved' },
      { label: 'Publish', who: 'Admin', status: 'pending' },
    ],
  },
  erd: {
    title: 'A data model title',
    entities: [
      { name: 'Customer', fields: [{ name: 'id', type: 'uuid', pk: true }, { name: 'name', type: 'text' }, { name: 'email', type: 'text' }] },
      { name: 'Order', fields: [{ name: 'id', type: 'uuid', pk: true }, { name: 'customer_id', type: 'uuid', fk: true }, { name: 'total', type: 'money' }] },
    ],
    relations: [{ from: 0, to: 1, cardinality: '1 → N' }],
  },
  'data-flow': {
    title: 'A data flow title',
    sources: [{ label: 'Form', icon: 'forms' }],
    process: 'Validation',
    stores: [{ label: 'Database', icon: 'database' }],
    sinks: [{ label: 'Dashboard', icon: 'layout-dashboard' }],
  },
  deployment: {
    title: 'A deployment title',
    zones: [
      { label: 'Edge', items: [{ id: 'cdn', label: 'CDN', icon: 'world' }] },
      { label: 'App', items: [{ id: 'api', label: 'API' }, { id: 'worker', label: 'Worker' }] },
      { label: 'Data', items: [{ id: 'db', label: 'Database' }, { id: 'cache', label: 'Cache' }] },
    ],
    links: [
      { from: 'cdn', to: 'api' },
      { from: 'api', to: 'db', label: 'SQL' },
      { from: 'worker', to: 'cache' },
    ],
  },
  'mind-map': {
    title: 'A mind map title',
    center: 'The idea',
    branches: [
      { label: 'Branch one', children: ['Leaf A', 'Leaf B'] },
      { label: 'Branch two', children: ['Leaf C'] },
      { label: 'Branch three', children: ['Leaf D', 'Leaf E'] },
    ],
  },
  venn: {
    title: 'A venn title',
    sets: [{ label: 'Set one' }, { label: 'Set two' }, { label: 'Set three' }],
    intersections: ['Overlap'],
  },
  pyramid: {
    title: 'A pyramid title',
    levels: [{ label: 'Top level' }, { label: 'Middle level' }, { label: 'Base level' }],
  },
  matrix: {
    title: 'A matrix title',
    x: { label: 'Effort', low: 'Low', high: 'High' },
    y: { label: 'Impact', low: 'Low', high: 'High' },
    quadrants: [
      { label: 'Do first', items: ['Item one', 'Item two'] },
      { label: 'Plan', items: ['Item three'] },
      { label: 'Delegate', items: ['Item four'] },
      { label: 'Drop', items: ['Item five'] },
    ],
  },
  quadrant: {
    title: 'A quadrant title',
    x: { label: 'Effort' },
    y: { label: 'Impact' },
    quadrants: ['Do first', 'Plan', 'Delegate', 'Drop'],
    points: [
      { label: 'One', x: 2, y: 8 },
      { label: 'Two', x: 6, y: 7 },
      { label: 'Three', x: 4, y: 3 },
      { label: 'Four', x: 8, y: 2 },
    ],
  },
  treemap: {
    title: 'A treemap title',
    items: [
      { label: 'Item one', value: 40 },
      { label: 'Item two', value: 25 },
      { label: 'Item three', value: 18 },
      { label: 'Item four', value: 10 },
      { label: 'Item five', value: 7 },
    ],
  },
  gantt: {
    title: 'A gantt title',
    tasks: [
      { label: 'Research', start: 0, end: 3 },
      { label: 'Build', start: 3, end: 8 },
      { label: 'Test', start: 8, end: 10 },
      { label: 'Launch', start: 10, end: 11 },
    ],
  },
  calendar: {
    title: 'A calendar title',
    month: 'The month',
    events: [
      { day: 3, label: 'Kickoff' },
      { day: 11, label: 'Review', tone: 'blue' },
      { day: 18, label: 'Ship', tone: 'accent' },
      { day: 25, label: 'Retro' },
    ],
  },
  milestones: {
    title: 'A milestones title',
    milestones: [
      { date: 'Q1', label: 'Milestone one' },
      { date: 'Q2', label: 'Milestone two' },
      { date: 'Q3', label: 'Milestone three' },
    ],
  },
  'journey-map': {
    title: 'A journey title',
    stages: ['Aware', 'Consider', 'Buy', 'Use'],
    rows: [
      { label: 'Action', values: ['Sees it', 'Compares', 'Pays', 'Uses'] },
      { label: 'Feeling', values: ['Curious', 'Unsure', 'Hopeful', 'Happy'] },
      { label: 'Pain', values: ['Noise', 'Confusion', 'Friction', 'Gaps'] },
    ],
  },
  flywheel: {
    title: 'A flywheel title',
    center: 'Momentum',
    steps: [
      { label: 'Attract', icon: 'magnet' },
      { label: 'Convert', icon: 'target' },
      { label: 'Delight', icon: 'heart' },
      { label: 'Refer', icon: 'users' },
    ],
  },
  'pros-cons': {
    title: 'A pros and cons title',
    pros: ['Fast', 'Simple', 'Cheap'],
    cons: ['Limited', 'Manual', 'Risky'],
  },
  'old-vs-new': {
    title: 'An old vs new title',
    old: { label: 'Old way', points: ['Manual', 'Slow', 'Fragile'] },
    new: { label: 'New way', points: ['Automated', 'Fast', 'Reliable'] },
  },
  iceberg: {
    title: 'An iceberg title',
    above: ['What people see'],
    below: ['The system', 'The rules', 'The maintenance'],
  },
  spectrum: {
    title: 'A spectrum title',
    low: 'Low',
    high: 'High',
    markers: [
      { label: 'Option A', position: 0.2 },
      { label: 'Option B', position: 0.55 },
      { label: 'Option C', position: 0.85 },
    ],
  },
  balance: {
    title: 'A balance title',
    left: { label: 'Cost', weight: 3 },
    right: { label: 'Value', weight: 7 },
    verdict: 'Worth it',
  },
  bullseye: {
    title: 'A bullseye title',
    rings: [{ label: 'Core' }, { label: 'Adjacent' }, { label: 'Outer' }],
  },
  'annotated-screenshot': {
    title: 'An annotated screenshot title',
    image: PLACEHOLDER_SHOT,
    callouts: [
      { x: 0.22, y: 0.22, label: 'First callout', side: 'right' },
      { x: 0.70, y: 0.52, label: 'Second callout', side: 'left' },
      { x: 0.30, y: 0.74, label: 'Third callout', side: 'right' },
    ],
  },
  wireframe: {
    title: 'A wireframe title',
    device: 'browser',
    url: 'app.example.com',
    blocks: [
      { type: 'heading', label: 'Page heading', at: { x: 0.08, y: 0.02, w: 0.84, h: 0.12 } },
      { type: 'image', label: 'Hero', at: { x: 0.08, y: 0.16, w: 0.84, h: 0.34 } },
      { type: 'text', label: 'A short description of the page.', at: { x: 0.08, y: 0.54, w: 0.60, h: 0.12 } },
      { type: 'button', label: 'Primary action', at: { x: 0.08, y: 0.72, w: 0.30, h: 0.09 } },
    ],
  },
  code: {
    title: 'A code title',
    language: 'js',
    lines: [
      'const total = items.reduce((n, i) => n + i.value, 0);',
      'if (total > budget) {',
      '  return plan(total, { mode: "strict" });',
      '}',
      'return plan(total);',
    ],
  },
  terminal: {
    title: 'A terminal title',
    lines: [
      { prompt: '$', text: 'npm run build' },
      { prompt: '>', text: 'building...' },
      { prompt: '>', text: 'done in 1.2s', tone: 'ok' },
    ],
  },
  chat: {
    title: 'A chat title',
    messages: [
      { side: 'left', name: 'Customer', text: 'Can this be automated?' },
      { side: 'right', name: 'You', text: 'Yes — here is how.' },
      { side: 'left', name: 'Customer', text: 'How long does it take?' },
    ],
  },
  post: {
    title: 'A post title',
    platform: 'Social',
    author: 'A name',
    handle: '@handle',
    text: 'A short post about the thing.',
    metrics: [
      { icon: 'heart', value: '1.2k', label: 'likes' },
      { icon: 'message', value: '84', label: 'replies' },
    ],
  },
  map: {
    title: 'A map title',
    markers: [
      { lon: -0.1, lat: 51.5, label: 'London' },
      { lon: -74, lat: 40.7, label: 'New York' },
      { lon: 139.7, lat: 35.7, label: 'Tokyo' },
    ],
  },
  'lower-third': {
    name: 'A name',
    role: 'A role',
  },
  'icon-grid': {
    title: 'An icon grid title',
    items: [
      { icon: 'bolt', label: 'Fast' },
      { icon: 'shield', label: 'Safe' },
      { icon: 'chart-line', label: 'Measured' },
      { icon: 'users', label: 'Shared' },
      { icon: 'settings', label: 'Configurable' },
      { icon: 'check', label: 'Reliable' },
    ],
  },
};

