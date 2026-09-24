import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import { pageTemplates, templateContent } from "./page-templates.js";

const clean = (value) => String(value ?? "").trim();
const enabled = (value) =>
  value === true || ["1", "true", "yes", "on"].includes(clean(value).toLowerCase());

const templateChoices = () =>
  Object.fromEntries(
    pageTemplates.map((template) => [
      template.key,
      `${template.name}: ${template.description}`,
    ]),
  );

const templateByKey = (key) =>
  pageTemplates.find((template) => template.key === key) || pageTemplates[0];

export function createTypeSafePageGenerator({
  apiKey,
  model = "jev-latest",
  client,
} = {}) {
  const typesafe =
    client ||
    (apiKey
      ? new TypeSafeClient({
          apiKey,
          defaultModel: model,
        })
      : null);
  if (!typesafe) return null;

  return async ({ product, title, brief }) => {
    const response = await typesafe.systemOne({
      model,
      state: {
        task: "Choose the best Commera2 product page template. Do not write copy.",
        title: clean(title),
        merchantInstructions: clean(brief),
        product: {
          name: clean(product?.name),
          description: clean(product?.description),
          pricePaise: Number(product?.pricePaise || 0),
          stock: Number(product?.stock || 0),
        },
        templates: pageTemplates.map((template) => ({
          key: template.key,
          name: template.name,
          category: template.category,
          description: template.description,
          sections: template.sections,
        })),
      },
      questions: {
        template: choice("Which template is the best fit?", templateChoices()),
      },
    });
    const selected = templateByKey(response.answers.template.choice),
      content = templateContent(selected, clean(title), product, "real", "INR");
    content.hero.eyebrow = "AI SELECTED TEMPLATE";
    content.hero.subheadline =
      clean(brief) || content.hero.subheadline || product.description;
    return content;
  };
}

export function createTypeSafeProjectOptions(env = process.env) {
  const apiKey = clean(env.TYPESAFE_API_KEY);
  if (!enabled(env.TYPESAFE_AI_ENABLED) || !apiKey) return {};
  return {
    aiGenerator: createTypeSafePageGenerator({
      apiKey,
      model: clean(env.TYPESAFE_MODEL) || "jev-latest",
    }),
    aiProvider: {
      provider: "TypeSafe Jev",
      model: clean(env.TYPESAFE_MODEL) || "jev-latest",
      authorized: true,
    },
  };
}
