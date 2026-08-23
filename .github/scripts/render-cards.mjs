// Generates assets/stats/stats.svg and assets/stats/top-langs.svg from live
// GitHub data. Run in CI (or locally) with GH_USERNAME and GITHUB_TOKEN set.

const USERNAME = process.env.GH_USERNAME;
const TOKEN = process.env.GITHUB_TOKEN;

const PALETTE = {
  bg: "#0d1220",
  border: "#283040",
  title: "#79c0ff",
  text: "#e6edf3",
  comment: "#6e7681",
  accent: "#56d364",
};

const FONT =
  "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace";

async function graphql(query) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

async function fetchProfile() {
  // ponytail: first:100 repos, add pagination if repo count ever exceeds 100
  const data = await graphql(`
    query {
      user(login: "${USERNAME}") {
        createdAt
        allRepos: repositories(ownerAffiliations: OWNER) {
          totalCount
        }
        starRepos: repositories(first: 100, ownerAffiliations: OWNER) {
          nodes { stargazerCount }
        }
        repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
          nodes {
            stargazerCount
            languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
              edges {
                size
                node { name color }
              }
            }
          }
        }
      }
      prs: search(query: "is:pr author:${USERNAME}", type: ISSUE) { issueCount }
      issues: search(query: "is:issue author:${USERNAME}", type: ISSUE) { issueCount }
    }
  `);

  const startYear = new Date(data.user.createdAt).getFullYear();
  const currentYear = new Date().getFullYear();
  const yearFields = [];
  for (let y = startYear; y <= currentYear; y++) {
    const to = y === currentYear ? new Date().toISOString() : `${y}-12-31T23:59:59Z`;
    yearFields.push(
      `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${to}") { totalCommitContributions }`
    );
  }
  const commitsData = await graphql(`
    query {
      user(login: "${USERNAME}") {
        ${yearFields.join("\n")}
      }
    }
  `);
  const totalCommits = Object.values(commitsData.user).reduce(
    (sum, y) => sum + y.totalCommitContributions,
    0
  );

  const repoNodes = data.user.repositories.nodes;
  // Stars count every owned repo including forks; languages stay non-fork only
  // so forked codebases don't skew the top-languages breakdown.
  const totalStars = data.user.starRepos.nodes.reduce(
    (s, r) => s + r.stargazerCount,
    0
  );

  const langBytes = new Map();
  const langColors = new Map();
  for (const repo of repoNodes) {
    for (const edge of repo.languages.edges) {
      const name = edge.node.name;
      langBytes.set(name, (langBytes.get(name) || 0) + edge.size);
      if (edge.node.color) langColors.set(name, edge.node.color);
    }
  }
  const totalBytes = [...langBytes.values()].reduce((a, b) => a + b, 0);
  const sortedLangs = [...langBytes.entries()].sort((a, b) => b[1] - a[1]);
  const top = sortedLangs.slice(0, 6);
  const rest = sortedLangs.slice(6);
  const languages = top.map(([name, bytes]) => ({
    name,
    pct: (bytes / totalBytes) * 100,
    color: langColors.get(name) || PALETTE.comment,
  }));
  if (rest.length > 0) {
    const restBytes = rest.reduce((s, [, b]) => s + b, 0);
    languages.push({
      name: "Other",
      pct: (restBytes / totalBytes) * 100,
      color: PALETTE.comment,
    });
  }

  return {
    totalStars,
    totalCommits,
    totalPRs: data.prs.issueCount,
    totalIssues: data.issues.issueCount,
    publicRepos: data.user.allRepos.totalCount,
    languages,
  };
}

const ICONS = {
  star: "M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25zm0 2.445L6.615 5.5a.75.75 0 01-.564.41l-3.097.45 2.24 2.184a.75.75 0 01.216.664l-.528 3.084 2.769-1.456a.75.75 0 01.698 0l2.77 1.456-.53-3.084a.75.75 0 01.216-.664l2.24-2.183-3.096-.45a.75.75 0 01-.564-.41L8 2.694v.001z",
  commit: "M10.5 7.75a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zm1.43.75a4.002 4.002 0 01-7.86 0H.75a.75.75 0 110-1.5h3.32a4.001 4.001 0 017.86 0h3.32a.75.75 0 110 1.5h-3.32z",
  pr: "M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z",
  issue: "M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm9 3a1 1 0 11-2 0 1 1 0 012 0zm-.25-6.25a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0v-3.5z",
  repo: "M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8zM5 12.25v3.25a.25.25 0 00.4.2l1.45-1.087a.25.25 0 01.3 0L8.6 15.7a.25.25 0 00.4-.2v-3.25a.25.25 0 00-.25-.25h-3.5a.25.25 0 00-.25.25z",
};

function icon(name, x, y) {
  return `<g transform="translate(${x},${y})" fill="${PALETTE.comment}"><path d="${ICONS[name]}"/></g>`;
}

function card(width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<style>text{font-family:${FONT};}</style>` +
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="${PALETTE.bg}" stroke="${PALETTE.border}"/>` +
    body +
    `</svg>`;
}

function renderStats(stats, height) {
  const width = 400;
  const rows = [
    ["star", "Total Stars", stats.totalStars],
    ["commit", "Total Commits", stats.totalCommits],
    ["pr", "Total PRs", stats.totalPRs],
    ["issue", "Total Issues", stats.totalIssues],
    ["repo", "Public Repos", stats.publicRepos],
  ];
  const naturalHeight = 60 + rows.length * 28 + 16;
  const startY = 68 + (height - naturalHeight) / 2;

  let body = "";
  body += `<text x="24" y="38" fill="${PALETTE.title}" font-size="20" font-weight="700">Stats</text>`;
  rows.forEach(([iconName, label, value], i) => {
    const y = startY + i * 28;
    body += icon(iconName, 24, y - 12);
    body += `<text x="52" y="${y}" fill="${PALETTE.comment}" font-size="14">${label}</text>`;
    body += `<text x="${width - 24}" y="${y}" fill="${PALETTE.text}" font-size="14" font-weight="700" text-anchor="end">${value.toLocaleString()}</text>`;
  });
  return card(width, height, body);
}

function renderTopLangs(stats, height) {
  const width = 400;
  const barX = 24;
  const barWidth = width - 48;

  let body = `<text x="24" y="38" fill="${PALETTE.title}" font-size="20" font-weight="700">Top Languages</text>`;

  let bar = "";
  let x = barX;
  stats.languages.forEach((lang, i) => {
    const w =
      i === stats.languages.length - 1
        ? barX + barWidth - x
        : (lang.pct / 100) * barWidth;
    bar += `<rect x="${x}" y="52" width="${Math.max(w, 0)}" height="10" fill="${lang.color}"/>`;
    x += w;
  });
  body += `<clipPath id="bar-clip"><rect x="${barX}" y="52" width="${barWidth}" height="10" rx="5"/></clipPath>`;
  body += `<g clip-path="url(#bar-clip)">${bar}</g>`;

  stats.languages.forEach((lang, i) => {
    const y = 90 + i * 26;
    body += `<circle cx="30" cy="${y - 5}" r="6" fill="${lang.color}"/>`;
    body += `<text x="46" y="${y}" fill="${PALETTE.text}" font-size="14">${lang.name}</text>`;
    body += `<text x="${width - 24}" y="${y}" fill="${PALETTE.comment}" font-size="14" text-anchor="end">${lang.pct.toFixed(1)}%</text>`;
  });

  return card(width, height, body);
}

const fs = await import("node:fs");
const stats = await fetchProfile();
fs.mkdirSync("assets/stats", { recursive: true });

// Cards are shown side by side in the README, so give them matching heights
// (default vertical-align on inline <img> aligns baselines, not tops, and
// GitHub strips style="vertical-align" — matching heights sidesteps that).
const statsHeight = 60 + 5 * 28 + 16;
const langsHeight = 76 + stats.languages.length * 26;
const sharedHeight = Math.max(statsHeight, langsHeight);

fs.writeFileSync("assets/stats/stats.svg", renderStats(stats, sharedHeight));
fs.writeFileSync("assets/stats/top-langs.svg", renderTopLangs(stats, sharedHeight));
console.log(JSON.stringify(stats, null, 2));
