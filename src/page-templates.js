export const pageTemplates = [
  {
    key: "warm-story",
    category: "General",
    name: "Warm Story",
    description: "Story-led, human and trust-focused for any product.",
    preview: "Warm paper canvas, expressive typography, rounded proof cards.",
    designTokens: {
      background: "#f6f1e7",
      surface: "#fffdf8",
      text: "#20231f",
      muted: "#696b63",
      accent: "#1f5a46",
      accentText: "#ffffff",
      radius: "18px",
      font: "Georgia, serif",
    },
    sections: ["hero", "story", "benefits", "offer", "cta"],
  },
  {
    key: "clinical-proof",
    category: "Long Form",
    name: "Clinical Proof",
    description:
      "Precise, evidence-forward structure for benefit and ingredient clarity.",
    preview:
      "White and pale-blue surfaces, deep navy type, violet action color.",
    designTokens: {
      background: "#f7faff",
      surface: "#ffffff",
      text: "#071c32",
      muted: "#63758c",
      accent: "#533afd",
      accentText: "#ffffff",
      radius: "8px",
      font: "system-ui, sans-serif",
    },
    sections: ["hero", "metrics", "details", "benefits", "cta"],
  },
  {
    key: "premium-night",
    category: "Single Product",
    name: "Premium Night",
    description: "Cinematic dark product story with focused offer moments.",
    preview: "Near-black canvas, sculptural product card, singular blue CTA.",
    designTokens: {
      background: "#050505",
      surface: "#1b1b1d",
      text: "#f5f5f7",
      muted: "#a8a8ae",
      accent: "#2997ff",
      accentText: "#ffffff",
      radius: "12px",
      font: "system-ui, sans-serif",
    },
    sections: ["hero", "story", "features", "details", "offer", "cta"],
  },
  {
    key: "clean-minimal",
    category: "Minimal",
    name: "Clean Minimal",
    description:
      "A quiet, conversion-focused layout with generous space and a direct offer.",
    preview:
      "Soft white canvas, crisp typography, compact proof and a focused checkout action.",
    designTokens: {
      background: "#f8f8f6",
      surface: "#ffffff",
      text: "#171917",
      muted: "#707570",
      accent: "#173e34",
      accentText: "#ffffff",
      radius: "6px",
      font: "system-ui, sans-serif",
    },
    sections: ["hero", "benefits", "details", "offer", "cta"],
  },
];

export function templateContent(
  template,
  title,
  product,
  _socialProofType = "real",
  currency = "INR",
) {
  const formattedPrice = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(product.pricePaise / 100);
  const sectionCopy = {
    story: {
      type: "story",
      title: "Product overview",
      body: product.description || `Learn more about ${product.name}.`,
    },
    benefits: {
      type: "benefits",
      title: "Product highlights",
      items: [
        "Add a verified product benefit",
        "Add a product feature",
        "Add usage or delivery information",
      ],
    },
    offer: {
      type: "offer",
      title: "Product options",
      body: `Available from ${formattedPrice}.`,
    },
    metrics: {
      type: "metrics",
      title: "The essentials at a glance",
      items: [
        "Clear product details",
        "Transparent offer",
        "Simple COD checkout",
      ],
    },
    details: {
      type: "details",
      title: "Product details",
      body: product.description || "Add verified product information.",
    },
    features: {
      type: "benefits",
      title: "Product features",
      items: [
        "Add the first product feature",
        "Add the second product feature",
        "Add the third product feature",
      ],
    },
    cta: {
      type: "cta",
      title: "Order this product",
      body: "Order securely with cash on delivery.",
    },
  };
  const sections = template.sections
    .slice(1)
    .map((type) => structuredClone(sectionCopy[type]))
    .filter(Boolean);

  return {
    hero: {
      eyebrow: "PRODUCT HIGHLIGHT",
      headline: title,
      subheadline:
        product.description || `Explore ${product.name} and order securely.`,
    },
    sections,
    ctaText: "Order with COD",
    announcement: "",
  };
}
