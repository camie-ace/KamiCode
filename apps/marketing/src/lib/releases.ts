const REPO = "camie-ace/KamiCode";

export const REPOSITORY_URL = `https://github.com/${REPO}`;
export const RELEASES_URL = `${REPOSITORY_URL}/releases`;
export const LATEST_WINDOWS_DOWNLOAD_URL = `${RELEASES_URL}/latest/download/KamiCode-Setup-x64.exe`;

const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const CACHE_KEY = "kamicode-latest-release";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface Release {
  tag_name: string;
  html_url: string;
  assets: ReleaseAsset[];
}

export async function fetchLatestRelease(): Promise<Release> {
  const cached = sessionStorage.getItem(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const data = await fetch(API_URL).then((r) => r.json());

  if (data?.assets) {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
  }

  return data;
}
