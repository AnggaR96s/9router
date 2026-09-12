// Add-on skills metadata for the dashboard UI.
// English labels, descriptions, and categories.
export const ADDON_SKILLS = [
  {
    id: "human-handwritten",
    name: "Human Handwritten",
    tagline: "Anti-AI-slop copywriting",
    description:
      "Enforces natural phrasing, headlines, and tone with zero robotic clichés or formulaic transitions. Sourced from miqdadbadjuber/anti-slop.",
    category: "Writing Quality",
  },
  {
    id: "watermarks-remover",
    name: "Watermarks Remover",
    tagline: "Provenance and mark cleaner",
    description:
      "Strips invisible Unicode characters (zero-width spaces, bidi overrides), C2PA tags, and transition cliches. Sourced from guillaumemeyer/watermarks-remover.",
    category: "Hygiene",
  },
  {
    id: "commit-lint",
    name: "Commit Lint",
    tagline: "Conventional Commits enforcement",
    description:
      "Injects a strict Conventional Commits specification prompt into the system prompt so generated commit messages match repo standards.",
    category: "Developer Experience",
  },
];
