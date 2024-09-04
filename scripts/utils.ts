import * as fs from "fs";
import * as path from "path";

const relativePath = "../deployments/";

const jsons: Record<string, string> = {
  addresses: "addresses.json",
  config: "config.json",
  abis: "abis.json",
};

function getJson(file: string): Record<string, any> {
  let json: string;
  try {
    json = fs.readFileSync(path.join(__dirname, relativePath, file), "utf8");
  } catch (err) {
    json = "{}";
  }
  return JSON.parse(json);
}

function saveJson(
  file: string,
  network: string,
  key: string,
  value: any,
): void {
  const json = getJson(file);
  json[network] = json[network] || {};
  json[network][key] = value;
  fs.writeFileSync(
    path.join(__dirname, relativePath, file),
    JSON.stringify(json, null, "  "),
  );
}

export { jsons, getJson, saveJson };
