import type { RequestAuth, RequestBody } from '@/types';

export interface CodegenInput {
  method: string;
  url: string;
  headers: Record<string, string>;
  params: Record<string, string>;
  body?: RequestBody;
  auth?: RequestAuth;
}

export type CodegenLanguage =
  | 'curl'
  | 'javascript_fetch'
  | 'javascript_axios'
  | 'python_requests'
  | 'go'
  | 'java'
  | 'csharp'
  | 'php_curl'
  | 'ruby'
  | 'swift'
  | 'kotlin'
  | 'rust'
  | 'dart';

function buildFullURL(rawURL: string, params: Record<string, string>, auth?: RequestAuth): string {
  let url: URL;
  try {
    url = new URL(rawURL);
  } catch {
    return rawURL;
  }
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  if (auth?.type === 'apikey' && auth.addTo === 'query' && auth.key) {
    url.searchParams.set(auth.key, auth.value ?? '');
  }
  return url.toString();
}

function buildEffectiveHeaders(
  headers: Record<string, string>,
  auth?: RequestAuth,
  body?: RequestBody,
): Record<string, string> {
  const effective: Record<string, string> = { ...headers };

  if (body && !effective['Content-Type']) {
    switch (body.type) {
      case 'json':
      case 'graphql':
        effective['Content-Type'] = 'application/json';
        break;
      case 'xml':
        effective['Content-Type'] = 'application/xml';
        break;
      case 'form':
        effective['Content-Type'] = 'application/x-www-form-urlencoded';
        break;
    }
  }

  // SOAP derives its Content-Type + SOAPAction from the version (same logic as
  // the send path in requestStore) so generated code (curl/fetch/…) carries
  // them — otherwise the snippet defaults to form-encoding and the SOAP server
  // returns 415 Unsupported Media Type.
  if (body && body.type === 'soap') {
    const version = body.soapVersion || '1.1';
    const action = (body.soapAction || '').trim();
    const has = (name: string) => Object.keys(effective).some((k) => k.toLowerCase() === name);
    if (!has('content-type')) {
      effective['Content-Type'] =
        version === '1.2'
          ? action
            ? `application/soap+xml; charset=utf-8; action="${action}"`
            : 'application/soap+xml; charset=utf-8'
          : 'text/xml; charset=utf-8';
    }
    if (version === '1.1' && !has('soapaction')) {
      effective['SOAPAction'] = action ? `"${action}"` : '""';
    }
  }

  if (auth) {
    switch (auth.type) {
      case 'bearer':
        if (auth.token) effective['Authorization'] = `Bearer ${auth.token}`;
        break;
      case 'basic': {
        const cred = btoa(`${auth.username ?? ''}:${auth.password ?? ''}`);
        effective['Authorization'] = `Basic ${cred}`;
        break;
      }
      case 'apikey':
        if (auth.addTo !== 'query' && auth.key) {
          effective[auth.key] = auth.value ?? '';
        }
        break;
    }
  }

  return effective;
}

function sortedKeys(obj: Record<string, string>): string[] {
  return Object.keys(obj).sort();
}

function escapeDouble(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeSingle(s: string): string {
  return s.replace(/'/g, "'\\''");
}

function bodyContent(body?: RequestBody): string {
  if (!body || body.type === 'none') return '';
  return body.content ?? '';
}

function capitalizeMethod(method: string): string {
  const m = method.toLowerCase();
  if (!m) return m;
  return m[0].toUpperCase() + m.slice(1);
}

function genCurl(method: string, url: string, headers: Record<string, string>, body: string): string {
  let out = `curl -X ${method.toUpperCase()} '${escapeSingle(url)}'`;
  for (const k of sortedKeys(headers)) {
    out += ` \\\n  -H '${escapeSingle(k)}: ${escapeSingle(headers[k])}'`;
  }
  if (body) out += ` \\\n  -d '${escapeSingle(body)}'`;
  return out;
}

function genJSFetch(method: string, url: string, headers: Record<string, string>, body: string): string {
  let out = `const response = await fetch('${escapeDouble(url)}', {\n`;
  out += `  method: '${method.toUpperCase()}',\n`;
  if (Object.keys(headers).length) {
    out += `  headers: {\n`;
    for (const k of sortedKeys(headers)) {
      out += `    '${escapeDouble(k)}': '${escapeDouble(headers[k])}',\n`;
    }
    out += `  },\n`;
  }
  if (body) out += `  body: '${escapeDouble(body)}',\n`;
  out += `});\n\n`;
  out += `const data = await response.text();\n`;
  out += `console.log(response.status, data);`;
  return out;
}

function genJSAxios(method: string, url: string, headers: Record<string, string>, body: string): string {
  let out = `const axios = require('axios');\n\n`;
  out += `const config = {\n`;
  out += `  method: '${method.toLowerCase()}',\n`;
  out += `  url: '${escapeDouble(url)}',\n`;
  if (Object.keys(headers).length) {
    out += `  headers: {\n`;
    for (const k of sortedKeys(headers)) {
      out += `    '${escapeDouble(k)}': '${escapeDouble(headers[k])}',\n`;
    }
    out += `  },\n`;
  }
  if (body) out += `  data: '${escapeDouble(body)}',\n`;
  out += `};\n\n`;
  out += `axios(config)\n`;
  out += `  .then(response => console.log(response.status, response.data))\n`;
  out += `  .catch(error => console.error(error));`;
  return out;
}

function genPython(method: string, url: string, headers: Record<string, string>, body: string): string {
  let out = `import requests\n\n`;
  out += `url = "${escapeDouble(url)}"\n`;
  if (Object.keys(headers).length) {
    out += `headers = {\n`;
    for (const k of sortedKeys(headers)) {
      out += `    "${escapeDouble(k)}": "${escapeDouble(headers[k])}",\n`;
    }
    out += `}\n`;
  }
  if (body) out += `payload = "${escapeDouble(body)}"\n`;
  out += `\n`;
  out += `response = requests.${method.toLowerCase()}(url`;
  if (Object.keys(headers).length) out += `, headers=headers`;
  if (body) out += `, data=payload`;
  out += `)\n\n`;
  out += `print(response.status_code)\n`;
  out += `print(response.text)`;
  return out;
}

function genGo(method: string, url: string, headers: Record<string, string>, body: string): string {
  let out = `package main\n\n`;
  out += `import (\n`;
  out += `\t"fmt"\n\t"io"\n\t"net/http"\n`;
  if (body) out += `\t"strings"\n`;
  out += `)\n\n`;
  out += `func main() {\n`;
  if (body) {
    out += `\tbody := strings.NewReader(\`${body}\`)\n`;
    out += `\treq, err := http.NewRequest("${method.toUpperCase()}", "${escapeDouble(url)}", body)\n`;
  } else {
    out += `\treq, err := http.NewRequest("${method.toUpperCase()}", "${escapeDouble(url)}", nil)\n`;
  }
  out += `\tif err != nil {\n\t\tpanic(err)\n\t}\n\n`;
  for (const k of sortedKeys(headers)) {
    out += `\treq.Header.Set("${escapeDouble(k)}", "${escapeDouble(headers[k])}")\n`;
  }
  out += `\n\tclient := &http.Client{}\n`;
  out += `\tresp, err := client.Do(req)\n`;
  out += `\tif err != nil {\n\t\tpanic(err)\n\t}\n`;
  out += `\tdefer resp.Body.Close()\n\n`;
  out += `\trespBody, _ := io.ReadAll(resp.Body)\n`;
  out += `\tfmt.Println(resp.StatusCode)\n`;
  out += `\tfmt.Println(string(respBody))\n`;
  out += `}`;
  return out;
}

function genJava(method: string, url: string, headers: Record<string, string>, body: string): string {
  let out = `import java.net.URI;\n`;
  out += `import java.net.http.HttpClient;\n`;
  out += `import java.net.http.HttpRequest;\n`;
  out += `import java.net.http.HttpResponse;\n\n`;
  out += `public class Main {\n`;
  out += `    public static void main(String[] args) throws Exception {\n`;
  out += `        HttpClient client = HttpClient.newHttpClient();\n\n`;
  out += `        HttpRequest request = HttpRequest.newBuilder()\n`;
  out += `            .uri(URI.create("${escapeDouble(url)}"))\n`;
  if (body) {
    out += `            .method("${method.toUpperCase()}", HttpRequest.BodyPublishers.ofString("${escapeDouble(body)}"))\n`;
  } else if (method.toUpperCase() === 'GET') {
    out += `            .GET()\n`;
  } else {
    out += `            .method("${method.toUpperCase()}", HttpRequest.BodyPublishers.noBody())\n`;
  }
  for (const k of sortedKeys(headers)) {
    out += `            .header("${escapeDouble(k)}", "${escapeDouble(headers[k])}")\n`;
  }
  out += `            .build();\n\n`;
  out += `        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());\n`;
  out += `        System.out.println(response.statusCode());\n`;
  out += `        System.out.println(response.body());\n`;
  out += `    }\n`;
  out += `}`;
  return out;
}

function genCSharp(method: string, url: string, headers: Record<string, string>, body: string): string {
  let out = `using System;\n`;
  out += `using System.Net.Http;\n`;
  out += `using System.Threading.Tasks;\n\n`;
  out += `class Program\n{\n`;
  out += `    static async Task Main(string[] args)\n    {\n`;
  out += `        using var client = new HttpClient();\n\n`;
  out += `        var request = new HttpRequestMessage(HttpMethod.${capitalizeMethod(method)}, "${escapeDouble(url)}");\n`;
  for (const k of sortedKeys(headers)) {
    if (k.toLowerCase() === 'content-type') continue;
    out += `        request.Headers.TryAddWithoutValidation("${escapeDouble(k)}", "${escapeDouble(headers[k])}");\n`;
  }
  if (body) {
    const ct = headers['Content-Type'] || 'application/json';
    out += `        request.Content = new StringContent("${escapeDouble(body)}", System.Text.Encoding.UTF8, "${escapeDouble(ct)}");\n`;
  }
  out += `\n        var response = await client.SendAsync(request);\n`;
  out += `        var responseBody = await response.Content.ReadAsStringAsync();\n`;
  out += `        Console.WriteLine((int)response.StatusCode);\n`;
  out += `        Console.WriteLine(responseBody);\n`;
  out += `    }\n}`;
  return out;
}

function genPHP(method: string, url: string, headers: Record<string, string>, body: string): string {
  let out = `<?php\n\n`;
  out += `$ch = curl_init();\n\n`;
  out += `curl_setopt($ch, CURLOPT_URL, '${escapeSingle(url)}');\n`;
  out += `curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\n`;
  out += `curl_setopt($ch, CURLOPT_CUSTOMREQUEST, '${method.toUpperCase()}');\n`;
  if (Object.keys(headers).length) {
    out += `curl_setopt($ch, CURLOPT_HTTPHEADER, [\n`;
    for (const k of sortedKeys(headers)) {
      out += `    '${escapeSingle(k)}: ${escapeSingle(headers[k])}',\n`;
    }
    out += `]);\n`;
  }
  if (body) out += `curl_setopt($ch, CURLOPT_POSTFIELDS, '${escapeSingle(body)}');\n`;
  out += `\n$response = curl_exec($ch);\n`;
  out += `$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);\n`;
  out += `curl_close($ch);\n\n`;
  out += `echo $httpCode . "\\n";\n`;
  out += `echo $response;\n`;
  return out;
}

function genRuby(method: string, url: string, headers: Record<string, string>, body: string): string {
  const klass: Record<string, string> = {
    GET: 'Net::HTTP::Get',
    POST: 'Net::HTTP::Post',
    PUT: 'Net::HTTP::Put',
    PATCH: 'Net::HTTP::Patch',
    DELETE: 'Net::HTTP::Delete',
    HEAD: 'Net::HTTP::Head',
    OPTIONS: 'Net::HTTP::Options',
  };
  const httpClass = klass[method.toUpperCase()] ?? 'Net::HTTP::Get';

  let out = `require 'net/http'\n`;
  out += `require 'uri'\n\n`;
  out += `uri = URI.parse('${escapeSingle(url)}')\n`;
  out += `request = ${httpClass}.new(uri)\n`;
  for (const k of sortedKeys(headers)) {
    out += `request['${escapeSingle(k)}'] = '${escapeSingle(headers[k])}'\n`;
  }
  if (body) out += `request.body = '${escapeSingle(body)}'\n`;
  out += `\nhttp = Net::HTTP.new(uri.host, uri.port)\n`;
  out += `http.use_ssl = (uri.scheme == 'https')\n`;
  out += `response = http.request(request)\n\n`;
  out += `puts response.code\n`;
  out += `puts response.body`;
  return out;
}

function genSwift(method: string, url: string, headers: Record<string, string>, body: string): string {
  let out = `import Foundation\n\n`;
  out += `let url = URL(string: "${escapeDouble(url)}")!\n`;
  out += `var request = URLRequest(url: url)\n`;
  out += `request.httpMethod = "${method.toUpperCase()}"\n`;
  for (const k of sortedKeys(headers)) {
    out += `request.setValue("${escapeDouble(headers[k])}", forHTTPHeaderField: "${escapeDouble(k)}")\n`;
  }
  if (body) out += `request.httpBody = "${escapeDouble(body)}".data(using: .utf8)\n`;
  out += `\nlet semaphore = DispatchSemaphore(value: 0)\n\n`;
  out += `let task = URLSession.shared.dataTask(with: request) { data, response, error in\n`;
  out += `    if let error = error {\n`;
  out += `        print("Error: \\(error)")\n`;
  out += `        semaphore.signal()\n`;
  out += `        return\n`;
  out += `    }\n`;
  out += `    if let httpResponse = response as? HTTPURLResponse {\n`;
  out += `        print(httpResponse.statusCode)\n`;
  out += `    }\n`;
  out += `    if let data = data, let body = String(data: data, encoding: .utf8) {\n`;
  out += `        print(body)\n`;
  out += `    }\n`;
  out += `    semaphore.signal()\n`;
  out += `}\n\n`;
  out += `task.resume()\n`;
  out += `semaphore.wait()`;
  return out;
}

function genKotlin(method: string, url: string, headers: Record<string, string>, body: string): string {
  let out = `import okhttp3.OkHttpClient\n`;
  out += `import okhttp3.Request\n`;
  if (body) {
    out += `import okhttp3.RequestBody.Companion.toRequestBody\n`;
    out += `import okhttp3.MediaType.Companion.toMediaType\n`;
  }
  out += `\nfun main() {\n`;
  out += `    val client = OkHttpClient()\n\n`;
  if (body) {
    const ct = headers['Content-Type'] || 'application/json';
    out += `    val body = "${escapeDouble(body)}".toRequestBody("${escapeDouble(ct)}".toMediaType())\n\n`;
  }
  out += `    val request = Request.Builder()\n`;
  out += `        .url("${escapeDouble(url)}")\n`;
  if (body) {
    out += `        .method("${method.toUpperCase()}", body)\n`;
  } else if (method.toUpperCase() === 'GET') {
    out += `        .get()\n`;
  } else {
    out += `        .method("${method.toUpperCase()}", null)\n`;
  }
  for (const k of sortedKeys(headers)) {
    out += `        .addHeader("${escapeDouble(k)}", "${escapeDouble(headers[k])}")\n`;
  }
  out += `        .build()\n\n`;
  out += `    val response = client.newCall(request).execute()\n`;
  out += `    println(response.code)\n`;
  out += `    println(response.body?.string())\n`;
  out += `}`;
  return out;
}

function genRust(method: string, url: string, headers: Record<string, string>, body: string): string {
  let out = `use reqwest;\n\n`;
  out += `#[tokio::main]\n`;
  out += `async fn main() -> Result<(), Box<dyn std::error::Error>> {\n`;
  out += `    let client = reqwest::Client::new();\n\n`;
  out += `    let response = client.${method.toLowerCase()}("${escapeDouble(url)}")\n`;
  for (const k of sortedKeys(headers)) {
    out += `        .header("${escapeDouble(k)}", "${escapeDouble(headers[k])}")\n`;
  }
  if (body) out += `        .body("${escapeDouble(body)}")\n`;
  out += `        .send()\n`;
  out += `        .await?;\n\n`;
  out += `    println!("{}", response.status());\n`;
  out += `    println!("{}", response.text().await?);\n\n`;
  out += `    Ok(())\n`;
  out += `}`;
  return out;
}

function genDart(method: string, url: string, headers: Record<string, string>, body: string): string {
  let out = `import 'package:http/http.dart' as http;\n\n`;
  out += `void main() async {\n`;
  out += `  final url = Uri.parse('${escapeSingle(url)}');\n\n`;
  if (Object.keys(headers).length) {
    out += `  final headers = {\n`;
    for (const k of sortedKeys(headers)) {
      out += `    '${escapeSingle(k)}': '${escapeSingle(headers[k])}',\n`;
    }
    out += `  };\n\n`;
  }
  const m = method.toLowerCase();
  if (body) {
    out += `  final body = '${escapeSingle(body)}';\n\n`;
    if (Object.keys(headers).length) {
      out += `  final response = await http.${m}(url, headers: headers, body: body);\n`;
    } else {
      out += `  final response = await http.${m}(url, body: body);\n`;
    }
  } else if (Object.keys(headers).length) {
    out += `  final response = await http.${m}(url, headers: headers);\n`;
  } else {
    out += `  final response = await http.${m}(url);\n`;
  }
  out += `\n  print(response.statusCode);\n`;
  out += `  print(response.body);\n`;
  out += `}`;
  return out;
}

export function generateCode(input: CodegenInput, language: CodegenLanguage): string {
  const fullURL = buildFullURL(input.url, input.params, input.auth);
  const headers = buildEffectiveHeaders(input.headers, input.auth, input.body);
  const body = bodyContent(input.body);

  switch (language) {
    case 'curl':
      return genCurl(input.method, fullURL, headers, body);
    case 'javascript_fetch':
      return genJSFetch(input.method, fullURL, headers, body);
    case 'javascript_axios':
      return genJSAxios(input.method, fullURL, headers, body);
    case 'python_requests':
      return genPython(input.method, fullURL, headers, body);
    case 'go':
      return genGo(input.method, fullURL, headers, body);
    case 'java':
      return genJava(input.method, fullURL, headers, body);
    case 'csharp':
      return genCSharp(input.method, fullURL, headers, body);
    case 'php_curl':
      return genPHP(input.method, fullURL, headers, body);
    case 'ruby':
      return genRuby(input.method, fullURL, headers, body);
    case 'swift':
      return genSwift(input.method, fullURL, headers, body);
    case 'kotlin':
      return genKotlin(input.method, fullURL, headers, body);
    case 'rust':
      return genRust(input.method, fullURL, headers, body);
    case 'dart':
      return genDart(input.method, fullURL, headers, body);
  }
}
