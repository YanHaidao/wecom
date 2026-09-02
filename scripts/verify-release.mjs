import { readFile } from "node:fs/promises";

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

const fail = (message) => {
  console.error(`Release verification failed: ${message}`);
  process.exit(1);
};

if (!tag) {
  fail("missing tag; pass v<package-version> as the first argument");
}

const expectedTag = `v${packageJson.version}`;
if (tag !== expectedTag) {
  fail(
    `tag ${JSON.stringify(tag)} does not match package version ${JSON.stringify(packageJson.version)}; expected ${expectedTag}`,
  );
}

if (packageJson.name !== "@yanhaidao/wecom") {
  fail(`unexpected package name ${JSON.stringify(packageJson.name)}`);
}

if (packageJson.private === true) {
  fail("package.json marks this package as private");
}

if (packageJson.publishConfig?.access !== "public") {
  fail('publishConfig.access must be "public"');
}

if (
  packageJson.repository?.url !==
  "git+https://github.com/YanHaidao/wecom.git"
) {
  fail("repository.url must exactly match the GitHub repository used by npm Trusted Publishing");
}

console.log(`Release metadata verified: ${packageJson.name}@${packageJson.version} (${tag})`);
