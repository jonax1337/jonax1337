// Renders the profile's stats and language cards as SVG, once per colour scheme.
// Usage: GITHUB_TOKEN=... node scripts/render-cards.mjs [output-dir]
import { mkdir, writeFile } from 'node:fs/promises';

const LOGIN = 'jonax1337';
const OUTPUT_DIR = process.argv[2] ?? 'dist';
const TOP_LANGUAGE_COUNT = 6;
const CARD_WIDTH = 400;
const CARD_HEIGHT = 190;
const PADDING = 24;
const ROW_HEIGHT = 24;
const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const UNKNOWN_LANGUAGE_COLOR = '#71717a';

const THEMES = {
  dark: { background: '#18181b', border: '#27272a', text: '#fafafa', muted: '#a1a1aa' },
  light: { background: '#ffffff', border: '#e4e4e7', text: '#18181b', muted: '#71717a' },
};

const PROFILE_QUERY = `query ($login: String!) {
  user(login: $login) {
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      contributionCalendar { totalContributions }
    }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

await main();

async function main() {
  const user = await fetchUser(requireToken());
  const stats = collectStats(user);
  const languages = rankLanguages(user.repositories.nodes);
  await mkdir(OUTPUT_DIR, { recursive: true });
  for (const [schemeName, theme] of Object.entries(THEMES)) {
    await writeFile(`${OUTPUT_DIR}/stats-${schemeName}.svg`, renderStatsCard(stats, theme));
    await writeFile(`${OUTPUT_DIR}/languages-${schemeName}.svg`, renderLanguagesCard(languages, theme));
  }
}

function requireToken() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not set; the GitHub GraphQL API requires one.');
  return token;
}

async function fetchUser(token) {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: PROFILE_QUERY, variables: { login: LOGIN } }),
  });
  if (!response.ok) throw new Error(`GitHub GraphQL request failed with HTTP ${response.status}.`);
  const { data, errors } = await response.json();
  if (errors) throw new Error(`GitHub GraphQL query for ${LOGIN} failed: ${JSON.stringify(errors)}`);
  return data.user;
}

function collectStats({ contributionsCollection: contributions, repositories }) {
  return [
    ['Contributions (last 12 months)', contributions.contributionCalendar.totalContributions],
    ['Commits', contributions.totalCommitContributions],
    ['Pull requests', contributions.totalPullRequestContributions],
    ['Stars earned', sum(repositories.nodes.map((repository) => repository.stargazerCount))],
    ['Repositories', repositories.totalCount],
  ];
}

function rankLanguages(repositories) {
  const languagesByName = new Map();
  for (const { size, node } of repositories.flatMap((repository) => repository.languages.edges)) {
    const language = languagesByName.get(node.name)
      ?? { name: node.name, color: node.color ?? UNKNOWN_LANGUAGE_COLOR, bytes: 0 };
    language.bytes += size;
    languagesByName.set(node.name, language);
  }
  const ranked = [...languagesByName.values()]
    .sort((first, second) => second.bytes - first.bytes)
    .slice(0, TOP_LANGUAGE_COUNT);
  const totalBytes = sum(ranked.map((language) => language.bytes));
  return ranked.map((language) => ({ ...language, share: language.bytes / totalBytes }));
}

function renderStatsCard(stats, theme) {
  const rows = stats.map(([label, value], index) => {
    const y = 70 + index * ROW_HEIGHT;
    return `<text x="${PADDING}" y="${y}" font-size="13" fill="${theme.muted}">${escapeXml(label)}</text>
  <text x="${CARD_WIDTH - PADDING}" y="${y}" font-size="13" font-weight="600" text-anchor="end" fill="${theme.text}">${value.toLocaleString('en-US')}</text>`;
  });
  return renderCard('Proof of work', rows.join('\n  '), theme);
}

function renderLanguagesCard(languages, theme) {
  const title = `Mostly ${languages[0].name}`;
  return renderCard(title, `${renderLanguageBar(languages)}\n  ${renderLanguageLegend(languages, theme)}`, theme);
}

function renderLanguageBar(languages) {
  const barWidth = CARD_WIDTH - 2 * PADDING;
  let x = PADDING;
  const segments = languages.map((language) => {
    const width = language.share * barWidth;
    const segment = `<rect x="${x.toFixed(2)}" y="56" width="${width.toFixed(2)}" height="8" fill="${language.color}"/>`;
    x += width;
    return segment;
  });
  return `<clipPath id="bar"><rect x="${PADDING}" y="56" width="${barWidth}" height="8" rx="4"/></clipPath>
  <g clip-path="url(#bar)">${segments.join('')}</g>`;
}

function renderLanguageLegend(languages, theme) {
  const columnWidth = (CARD_WIDTH - 2 * PADDING) / 2;
  const rowsPerColumn = Math.ceil(languages.length / 2);
  return languages.map((language, index) => {
    const x = PADDING + Math.floor(index / rowsPerColumn) * columnWidth;
    const y = 100 + (index % rowsPerColumn) * ROW_HEIGHT;
    const percent = `${(language.share * 100).toFixed(1)}%`;
    return `<circle cx="${x + 5}" cy="${y - 4}" r="5" fill="${language.color}"/>
  <text x="${x + 18}" y="${y}" font-size="13" fill="${theme.text}">${escapeXml(language.name)} <tspan fill="${theme.muted}">${percent}</tspan></text>`;
  }).join('\n  ');
}

function renderCard(title, body, theme) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" role="img" aria-label="${escapeXml(title)}">
  <style>text { font-family: ${FONT_STACK}; }</style>
  <rect x="0.5" y="0.5" width="${CARD_WIDTH - 1}" height="${CARD_HEIGHT - 1}" rx="10" fill="${theme.background}" stroke="${theme.border}"/>
  <text x="${PADDING}" y="38" font-size="15" font-weight="600" fill="${theme.text}">${escapeXml(title)}</text>
  ${body}
</svg>
`;
}

function sum(numbers) {
  return numbers.reduce((total, number) => total + number, 0);
}

function escapeXml(text) {
  return text.replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`);
}
