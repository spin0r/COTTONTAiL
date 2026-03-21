const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");
const FormData = require("form-data");
const { BASE_URL } = require("./config");

class MagicClient {
  constructor(cookies = null) {
    this.baseUrl = BASE_URL;
    this._cookiesStr = cookies;
    this._jar = null;
    this._client = null;
    this.headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
    };
  }

  _parseCookies(cookiesStr) {
    const cStr = cookiesStr || "";
    if (!cStr) return {};

    // Try JSON array format
    if (cStr.trim().startsWith("[")) {
      try {
        const arr = JSON.parse(cStr);
        const dict = {};
        for (const c of arr) {
          if (c.name && c.value !== undefined) dict[c.name] = c.value;
        }
        if (Object.keys(dict).length > 0) return dict;
      } catch (_) {}
    }

    // Raw string format
    const dict = {};
    let temp = cStr;
    if (temp.toLowerCase().startsWith("cookie:")) temp = temp.slice(7).trim();
    for (const item of temp.split(";")) {
      const idx = item.indexOf("=");
      if (idx !== -1) {
        const name = item.slice(0, idx).trim();
        const value = item.slice(idx + 1).trim();
        dict[name] = value;
      }
    }
    return dict;
  }

  _initClient() {
    if (this._client) return;

    const cookieDict = this._parseCookies(this._cookiesStr);
    const jar = new CookieJar();

    // Set XSRF header
    const xsrfToken = cookieDict["XSRF-TOKEN"];
    if (xsrfToken) {
      this.headers["X-XSRF-TOKEN"] = decodeURIComponent(xsrfToken);
    }

    // Populate jar
    for (const [name, value] of Object.entries(cookieDict)) {
      jar.setCookieSync(`${name}=${value}`, this.baseUrl);
    }

    this._jar = jar;
    this._client = wrapper(
      axios.create({
        baseURL: this.baseUrl,
        headers: this.headers,
        jar,
        withCredentials: true,
        timeout: 30000,
      }),
    );
  }

  updateCookies(cookiesStr) {
    this._cookiesStr = cookiesStr;
    this._client = null;
    this._jar = null;
  }

  async fetchTransfers() {
    this._initClient();
    try {
      const res = await this._client.get("/api/transfers/list");
      const data = res.data;
      if (data?.status === "success") return data.transfers_list || {};
      return { error: "API returned non-success status", data };
    } catch (e) {
      if (e.response) {
        const text =
          typeof e.response.data === "string"
            ? e.response.data
            : JSON.stringify(e.response.data);
        if (text.includes("<title>Login</title>") || text.includes("login")) {
          return { error: "Session expired. Please login again." };
        }
        return {
          error: `Status ${e.response.status}`,
          raw: text.slice(0, 100),
        };
      }
      return { error: e.message };
    }
  }

  async getFolderContents(folderId) {
    this._initClient();
    try {
      const res = await this._client.post("/api/folder/list", {
        folder_id: folderId,
      });
      return res.data;
    } catch (e) {
      console.error(`Error fetching folder ${folderId}:`, e.message);
      return null;
    }
  }

  async deleteTransfer(transferId) {
    this._initClient();
    try {
      const res = await this._client.delete(
        `/api/transfers/delete/${transferId}`,
      );
      return res.status >= 200 && res.status < 300;
    } catch (e) {
      console.error(`Error deleting transfer ${transferId}:`, e.message);
      return false;
    }
  }

  async uploadNzb(fileContent, filename) {
    this._initClient();
    try {
      const form = new FormData();
      form.append("name", filename.replace(/\.nzb$/i, ""));
      form.append("cat", "0");
      form.append("file[]", fileContent, {
        filename,
        contentType: "application/x-nzb",
      });

      const res = await this._client.post("/api/transfers/create", form, {
        headers: form.getHeaders(),
      });
      return res.data;
    } catch (e) {
      if (e.response) {
        const text =
          typeof e.response.data === "string"
            ? e.response.data
            : JSON.stringify(e.response.data);
        const titleMatch = text.match(/<title>(.*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1] : "Unknown HTML Page";
        return {
          error: `Invalid JSON response (Title: ${title})`,
          raw: text.slice(0, 200),
        };
      }
      return { error: e.message };
    }
  }

  async getAccountInfo() {
    this._initClient();
    try {
      // Scrape /account page HTML — same approach as original Python bot
      const res = await this._client.get("/account", {
        headers: {
          ...this.headers,
          Accept: "text/html,application/xhtml+xml,*/*",
        },
      });
      const html = typeof res.data === "string" ? res.data : "";

      const info = {};

      // Email via regex
      const emailMatch = html.match(
        /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/,
      );
      if (emailMatch) info.username = emailMatch[0];

      // Expiry — "membership is active until <date>"
      const expiryMatch = html.match(
        /membership is active until\s+([^\n<"]+)/i,
      );
      info.days_left = expiryMatch ? expiryMatch[1].trim() : "Unknown";

      // Traffic
      const trafficMatch = html.match(/Traffic[:\s]+([^\n<"]+)/i);
      info.status = trafficMatch ? trafficMatch[1].trim() : "unlimited";

      return info;
    } catch (e) {
      console.error("[getAccountInfo] failed:", e.message);
      return null;
    }
  }

  async renewFreeTrial() {
    this._initClient();
    const url = "https://magicnzb.com/api/free-trial";
    try {
      const res = await this._client.post(url);
      return res.data;
    } catch (e) {
      try {
        const res = await this._client.get(url);
        return res.data;
      } catch (e2) {
        return { error: e2.message };
      }
    }
  }
}

module.exports = MagicClient;
