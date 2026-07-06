import axios from "axios";
import FormData from "form-data";

export interface TelegraphNode {
  tag: string;
  children?: (string | TelegraphNode)[];
  attrs?: Record<string, string>;
}

export class TelegraphClient {
  private baseUrl = "https://api.telegra.ph";
  accessToken: string | null;

  constructor(accessToken: string | null = null) {
    this.accessToken = accessToken;
  }

  async createAccount(
    shortName = "MagicBot",
    authorName = "MagicNZB Bot"
  ): Promise<string | null> {
    try {
      const res = await axios.get(`${this.baseUrl}/createAccount`, {
        params: { short_name: shortName, author_name: authorName },
      });
      const data = res.data as { ok: boolean; result?: { access_token: string }; error?: string };
      if (data?.ok && data.result) {
        this.accessToken = data.result.access_token;
        return this.accessToken;
      }
      throw new Error(`Failed to create account: ${data?.error}`);
    } catch (e: any) {
      console.error("Telegraph Error:", e.message);
      return null;
    }
  }

  async createPage(title: string, content: TelegraphNode[]): Promise<string | null> {
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
      const data = res.data as { ok: boolean; result?: { url: string }; error?: string };
      if (data?.ok && data.result) return data.result.url;
      throw new Error(`Failed to create page: ${data?.error}`);
    } catch (e: any) {
      console.error("Telegraph Error:", e.message);
      return null;
    }
  }

  async editPage(path: string, title: string, content: TelegraphNode[]): Promise<string | null> {
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
      const data = res.data as { ok: boolean; result?: { url: string }; error?: string };
      if (data?.ok && data.result) return data.result.url;
      console.error("Telegraph Edit Error:", data?.error);
      return null;
    } catch (e: any) {
      console.error("Telegraph Error:", e.message);
      return null;
    }
  }

  static formatLinksToNodes(links: [string, string][]): TelegraphNode[] {
    const nodes: TelegraphNode[] = [{ tag: "h4", children: ["Extracted Links:"] }];
    for (const [name, url] of links) {
      nodes.push({ tag: "p", children: [name, { tag: "br" }, url] });
    }
    if (nodes.length === 1) return [{ tag: "p", children: ["No links found."] }];
    return nodes;
  }
}

export default TelegraphClient;
