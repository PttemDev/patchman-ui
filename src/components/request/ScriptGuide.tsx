import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type ScriptGuideTab = 'pre-request' | 'tests';

interface ScriptGuideProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: ScriptGuideTab;
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-muted rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre">
      {children}
    </pre>
  );
}

function Section({ title, description, code }: { title: string; description?: string; code?: string }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      {code && <CodeBlock>{code}</CodeBlock>}
    </section>
  );
}

export function ScriptGuide({ open, onOpenChange, initialTab = 'tests' }: ScriptGuideProps) {
  const { t } = useTranslation('request');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('guide.title')}</DialogTitle>
          <DialogDescription>
            {t('guide.description')}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue={initialTab} className="w-full">
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="pre-request">{t('subTabs.preRequest')}</TabsTrigger>
            <TabsTrigger value="tests">{t('subTabs.tests')}</TabsTrigger>
          </TabsList>

          <TabsContent value="pre-request" className="space-y-6 pt-4">
            <Section
              title={t('guide.preRequest.whatRunsTitle')}
              description={t('guide.preRequest.whatRunsDesc')}
            />

            <Section
              title="pm.request"
              description={t('guide.preRequest.pmRequestDesc')}
              code={`// Read
pm.request.method         // "GET"
pm.request.url            // final URL after env substitution
pm.request.body           // raw body string

// Headers
pm.request.headers.get("Content-Type")
pm.request.headers.set("X-Timestamp", Date.now().toString())
pm.request.headers.has("Authorization")
pm.request.headers.remove("X-Debug")`}
            />

            <Section
              title="pm.environment"
              description={t('guide.preRequest.pmEnvironmentDesc')}
              code={`const base = pm.environment.get("baseUrl");
pm.environment.set("requestId", crypto.randomUUID());
pm.environment.unset("oldToken");
pm.environment.has("authToken");`}
            />

            <Section
              title="console.log / console.error"
              description={t('guide.preRequest.consoleDesc')}
              code={`console.log("signing request", pm.request.method, pm.request.url);
console.error("missing env var");`}
            />

            <Section
              title={t('guide.preRequest.hmacTitle')}
              description={t('guide.preRequest.hmacDesc')}
              code={`const secret = pm.environment.get("apiSecret");
const nonce = Date.now().toString();
const payload = nonce + pm.request.body;

// goja sandbox supports modern JS; do whatever crypto lib your env supports.
// Here we fake it with a simple hash for illustration:
let h = 0;
for (let i = 0; i < payload.length; i++) h = (h * 31 + payload.charCodeAt(i)) | 0;
const sig = (h >>> 0).toString(16);

pm.request.headers.set("X-Nonce", nonce);
pm.request.headers.set("X-Signature", sig);
pm.request.headers.set("X-Key", secret);`}
            />

            <Section
              title={t('guide.preRequest.refreshTitle')}
              description={t('guide.preRequest.refreshDesc')}
              code={`if (!pm.environment.get("authToken")) {
  // You can't make HTTP calls from inside the script sandbox yet —
  // instead, rely on a prior request in your collection to populate
  // authToken via a test script (see the Tests tab).
  console.log("authToken missing — run the login request first");
}`}
            />
          </TabsContent>

          <TabsContent value="tests" className="space-y-6 pt-4">
            <Section
              title="pm.test(name, fn)"
              description={t('guide.tests.pmTestDesc')}
              code={`pm.test("Status code is 200", function () {
  pm.expect(pm.response.statusCode).to.equal(200);
});`}
            />

            <Section
              title="pm.expect(value)"
              description={t('guide.tests.pmExpectDesc')}
              code={`pm.expect(pm.response.statusCode).to.equal(200);
pm.expect(pm.response.json().name).to.equal("John");`}
            />

            <Section
              title=".to.equal(expected)"
              description={t('guide.tests.toEqualDesc')}
              code={`pm.test("Response has correct status", function () {
  pm.expect(pm.response.statusCode).to.equal(200);
  pm.expect(pm.response.json().active).to.equal(true);
});`}
            />

            <Section
              title=".to.not.equal(expected)"
              description={t('guide.tests.toNotEqualDesc')}
              code={`pm.test("Status is not an error", function () {
  pm.expect(pm.response.statusCode).to.not.equal(500);
});`}
            />

            <Section
              title=".to.be.above(n) / .to.be.below(n)"
              description={t('guide.tests.aboveBelowDesc')}
              code={`pm.test("Response time is acceptable", function () {
  pm.expect(pm.response.time).to.be.below(2000);
  pm.expect(pm.response.json().count).to.be.above(0);
});`}
            />

            <Section
              title=".to.have.property(name)"
              description={t('guide.tests.toHavePropertyDesc')}
              code={`pm.test("Response has required fields", function () {
  const json = pm.response.json();
  pm.expect(json).to.have.property("id");
  pm.expect(json).to.have.property("name");
  pm.expect(json).to.have.property("email");
});`}
            />

            <Section
              title=".to.include(value)"
              description={t('guide.tests.toIncludeDesc')}
              code={`pm.test("Response contains expected data", function () {
  pm.expect(pm.response.json().name).to.include("John");
  pm.expect(pm.response.json().tags).to.include("admin");
});`}
            />

            <Section
              title=".to.be.oneOf(array)"
              description={t('guide.tests.toBeOneOfDesc')}
              code={`pm.test("Status is success", function () {
  pm.expect(pm.response.statusCode).to.be.oneOf([200, 201, 204]);
});`}
            />

            <Section
              title="pm.response properties"
              description={t('guide.tests.pmResponseDesc')}
              code={`// Status code (number)
pm.response.statusCode  // e.g. 200

// Parse body as JSON
pm.response.json()  // e.g. { id: 1, name: "John" }

// Response headers (object)
pm.response.headers  // e.g. { "content-type": "application/json" }

// Response time in ms
pm.response.time  // e.g. 150`}
            />

            <Section
              title="pm.environment.set(key, value)"
              description={t('guide.tests.pmEnvSetDesc')}
              code={`// Save a field from the JSON response into an env var
const token = pm.response.json().access_token;
pm.environment.set("authToken", token);

// Read it back later in another request
pm.environment.get("authToken");

// Remove / check existence
pm.environment.unset("authToken");
pm.environment.has("authToken");`}
            />

            <Section
              title={t('guide.tests.quickExtractTitle')}
              description={t('guide.tests.quickExtractDesc')}
            />

            <Section
              title={t('guide.tests.fullExampleTitle')}
              code={`pm.test("Successful user creation", function () {
  pm.expect(pm.response.statusCode).to.equal(201);

  const json = pm.response.json();
  pm.expect(json).to.have.property("id");
  pm.expect(json.name).to.equal("John Doe");
  pm.expect(json.email).to.include("@");
  pm.expect(json.role).to.be.oneOf(["user", "admin"]);
});

pm.test("Response time is fast", function () {
  pm.expect(pm.response.time).to.be.below(500);
});

pm.test("Content-Type is JSON", function () {
  pm.expect(pm.response.headers["content-type"])
    .to.include("application/json");
});`}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
