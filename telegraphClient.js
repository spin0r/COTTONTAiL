const axios = require("axios");
const FormData = require("form-data");

class TelegraphClient {
  constructor(accessToken = null) {
    this.baseUrl = "https://api.telegra.ph";
    this.accessToken = accessToken;
  }

  async createAccount(shortName = "MagicBot", authorName = "MagicNZB Bot") {
    try {
      const res = await axios.get(`${this.baseUrl}/createAccount`, {
        params: { short_name: shortName, author_name: authorName },
      });
      if (res.data?.ok) {
        this.accessToken = res.data.result.access_token;
        return this.accessToken;
      }
      throw new Error(`Failed to create account: ${res.data?.error}`);
    } catch (e) {
      console.error("Telegraph Error:", e.message);
      return null;
    }
  }

  async createPage(title, content) {
    if (!this.accessToken) throw new Error("No Access Token provided.");
    try {
      const form = new FormData();
      form.append("access_token", this.accessToken);
      form.append("title", title);
      form.append("content", JSON.stringify(content));
      form.append("return_content", "false");

      const res = await axios.post(`${this.baseUrl}/createPage`, form, {
        headers: form.getHeaders(),
      });
      if (res.data?.ok) return res.data.result.url;
      throw new Error(`Failed to create page: ${res.data?.error}`);
    } catch (e) {
      console.error("Telegraph Error:", e.message);
      return null;
    }
  }

  async editPage(path, title, content) {
    if (!this.accessToken) throw new Error("No Access Token provided.");
    try {
      const form = new FormData();
      form.append("access_token", this.accessToken);
      form.append("title", title);
      form.append("content", JSON.stringify(content));
      form.append("return_content", "false");

      const res = await axios.post(`${this.baseUrl}/editPage/${path}`, form, {
        headers: form.getHeaders(),
      });
      if (res.data?.ok) return res.data.result.url;
      console.error("Telegraph Edit Error:", res.data?.error);
      return null;
    } catch (e) {
      console.error("Telegraph Error:", e.message);
      return null;
    }
  }

  static formatLinksToNodes(links) {
    const nodes = [{ tag: "h4", children: ["Extracted Links:"] }];
    for (const [name, url] of links) {
      nodes.push({ tag: "p", children: [name, { tag: "br" }, url] });
    }
    if (nodes.length === 1)
      return [{ tag: "p", children: ["No links found."] }];
    return nodes;
  }
}

module.exports = TelegraphClient;
