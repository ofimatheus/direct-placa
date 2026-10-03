import { LANDING_CONFIG } from "@/config/landing-config";
import { DEFAULT_PRODUCTS_SECTION, LANDING_SCHEMA_VERSION, MIDDLE_SECTIONS, type Cta, type LandingContent } from "./schema";

/**
 * Conteúdo PADRÃO da landing = exatamente a landing que já estava no ar
 * (textos da página + valores de src/config/landing-config.ts).
 *
 * É usado quando ainda não há nada publicado no CMS (ou quando a migration do
 * CMS ainda não foi aplicada) e como ponto de partida do primeiro rascunho.
 * Assim, aplicar a migration não deixa /revendedores vazia.
 */

const contactCta = (label: string): Cta => ({ label, action: "contact" });

export function defaultLandingContent(): LandingContent {
  const { wholesaleTiers, platform, contact, cta, faqPending } = LANDING_CONFIG;
  const faqPairs: [string, string][] = [
    ...(faqPending.requiresCompany ? ([["Preciso ter empresa para revender?", faqPending.requiresCompany]] as [string, string][]) : []),
    ["Existe preço obrigatório de revenda?", "Não. Você define o seu preço e a sua estratégia comercial."],
    ["Existe comissão sobre minhas vendas?", "Não. Você compra as placas no atacado e revende por conta própria; a DirectPlaca não cobra comissão sobre as suas vendas."],
    ["Tenho vínculo com a DirectPlaca?", "Não. A revenda é independente: não há vínculo empregatício, salário, metas, exclusividade nem prestação de contas das suas vendas."],
    ["Preciso pagar para utilizar a plataforma?", "Sim. A plataforma DirectPlaca tem uma mensalidade, separada da compra das placas, informada antes da compra."],
    ["O que recebo ao comprar?", "As placas do lote escolhido e o acesso à plataforma DirectPlaca, conforme o plano contratado."],
    ["Posso mudar o destino de uma placa depois?", "Sim. O destino é configurado pelo sistema, sem precisar trocar a placa física."],
  ];
  const digits = (contact.whatsappNumber ?? "").replace(/\D/g, "");

  return {
    schemaVersion: LANDING_SCHEMA_VERSION,
    order: [...MIDDLE_SECTIONS],
    nav: [
      { id: "nav-como-funciona", label: "Como funciona", section: "howItWorks", enabled: true },
      // Só aparece no menu quando "Nossos Produtos" tiver produto ativo publicado.
      { id: "nav-produtos", label: "Produtos", section: "products", enabled: true },
      { id: "nav-plataforma", label: "Plataforma", section: "platform", enabled: true },
      { id: "nav-atacado", label: "Atacado", section: "wholesale", enabled: true },
      { id: "nav-mensalidade", label: "Mensalidade", section: "subscription", enabled: true },
      { id: "nav-duvidas", label: "Dúvidas", section: "faq", enabled: true },
    ],
    headerCta: { enabled: true, cta: contactCta("Quero revender") },
    hero: {
      eyebrow: "Revenda DirectPlaca",
      title: "Placas inteligentes.",
      titleHighlight: "Tecnologia pronta para você vender.",
      text: "Compre placas com QR Code e NFC no atacado, tenha acesso à plataforma DirectPlaca e revenda para os seus próprios clientes, com o seu preço.",
      primaryCta: contactCta(cta.primary),
      secondaryCta: { label: cta.secondary, action: "section", section: "product" },
      bullets: ["Sem comissão sobre suas vendas", "Você define o preço", "Sem metas nem exclusividade"],
      image: { kind: "builtin", key: "tela-dashboard", alt: "Painel do revendedor DirectPlaca (tela real, dados de demonstração)" },
      showPlate: true,
    },
    howItWorks: {
      enabled: true,
      eyebrow: "Como funciona",
      title: "Do atacado ao seu cliente, em quatro passos.",
      text: "",
      steps: [
        { id: "passo-lote", icon: "box", title: "Escolha seu lote", text: "Compre as placas DirectPlaca no atacado, na quantidade que fizer sentido para você.", enabled: true },
        { id: "passo-plataforma", icon: "dashboard", title: "Acesse a plataforma", text: "Receba o seu painel para gerenciar placas e clientes em um só lugar.", enabled: true },
        { id: "passo-revenda", icon: "tag", title: "Revenda", text: "Defina o seu próprio preço e venda para os seus clientes.", enabled: true },
        { id: "passo-ative", icon: "qr", title: "Ative", text: "Vincule cada placa ao destino escolhido pelo cliente, direto pelo sistema.", enabled: true },
      ],
    },
    product: {
      enabled: true,
      eyebrow: "O produto",
      title: "Uma placa física com inteligência digital.",
      text: "Cada placa DirectPlaca une QR Code e NFC a um código individual. O destino fica na plataforma: quando precisar mudar, a mudança é feita no sistema.",
      image: null,
      imageCaption: "Ilustração. A arte de cada placa segue o template escolhido.",
      features: [
        { id: "qr-code", icon: "qr", title: "QR Code", text: "Lido pela câmera de praticamente qualquer celular.", enabled: true },
        { id: "nfc", icon: "nfc", title: "NFC", text: "Em celulares compatíveis, basta aproximar.", enabled: true },
        { id: "identificacao", icon: "plate", title: "Identificação individual", text: "Cada placa tem um código único.", enabled: true },
        { id: "ativacao", icon: "settings", title: "Ativação pelo sistema", text: "Você vincula a placa ao cliente pelo painel.", enabled: true },
        { id: "destino", icon: "link", title: "Destino alterável", text: "O destino é configurado digitalmente e pode ser alterado pelo sistema.", enabled: true },
        { id: "sem-trocar", icon: "layers", title: "Sem trocar a placa", text: "Mudou o destino? A placa física continua a mesma.", enabled: true },
      ],
      cta: null,
    },
    // Sem produtos fictícios: a seção existe no CMS, mas só aparece com imagens reais enviadas pelo ADMIN.
    products: structuredClone(DEFAULT_PRODUCTS_SECTION),
    platform: {
      enabled: true,
      eyebrow: "A plataforma",
      title: "Você vende a placa. A DirectPlaca entrega a tecnologia por trás dela.",
      text: "Junto com as placas, você usa um painel completo para acompanhar o seu estoque, cadastrar clientes, ativar placas e configurar destinos.",
      screenshots: [
        { id: "tela-dashboard", image: { kind: "builtin", key: "tela-dashboard", alt: "Dashboard do revendedor" }, caption: "Dashboard: placas, ativações, clientes e as suas vendas.", enabled: true },
        { id: "tela-placas", image: { kind: "builtin", key: "tela-placas", alt: "Minhas placas" }, caption: "Minhas placas: situação, cliente e destino de cada uma.", enabled: true },
        { id: "tela-clientes", image: { kind: "builtin", key: "tela-clientes", alt: "Clientes" }, caption: "Clientes: o seu cadastro, organizado por placa.", enabled: true },
      ],
      note: "Telas reais da plataforma, com dados de demonstração.",
      cta: null,
    },
    directlab: {
      enabled: true,
      eyebrow: "DirectLab",
      title: "Ferramentas que agregam valor ao que você vende.",
      text: "Além da gestão das placas, a plataforma inclui o DirectLab: ferramentas prontas para você oferecer aos seus clientes.",
      tools: [
        {
          id: "avaliacao-google",
          icon: "star",
          title: "Avaliação Google",
          text: "Localiza o estabelecimento e gera o link direto para o cliente dele deixar uma avaliação no Google.",
          image: { kind: "builtin", key: "tela-avaliacao-google", alt: "Ferramenta Avaliação Google gerando um link de avaliação" },
          imageStyle: "screen",
          cta: null,
          enabled: true,
        },
        {
          id: "directlink",
          icon: "link",
          title: "DirectLink",
          text: "Cria uma página para o cliente reunir redes sociais, WhatsApp, PIX, site e outros links, pronta para abrir pelo QR Code.",
          image: { kind: "builtin", key: "tela-directlink-publico", alt: "Página pública de um DirectLink no celular" },
          imageStyle: "phone",
          cta: null,
          enabled: true,
        },
      ],
      hubImage: { kind: "builtin", key: "tela-directlab", alt: "Hub do DirectLab no painel do revendedor" },
      hubCaption: "O DirectLab no painel: cada ferramenta como um aplicativo. Telas reais, dados de demonstração.",
    },
    wholesale: {
      enabled: true,
      eyebrow: "Compra no atacado",
      title: "Compre no atacado. Defina sua margem. Revenda por conta própria.",
      text: "",
      badge: "Quanto maior o lote, melhor a condição.",
      note: "Valores por unidade de placa. O acesso à plataforma é uma assinatura à parte, explicada logo abaixo.",
      tiers: wholesaleTiers.map((t) => {
        const custom = "custom" in t && Boolean(t.custom);
        return {
          id: `lote-${t.quantity}`,
          label: t.label,
          quantity: t.quantity,
          unitPriceCents: t.unitPriceCents,
          unitLabel: "por unidade",
          description: custom ? "Para lotes maiores, montamos a proposta com você." : "",
          badge: "",
          highlight: false,
          custom,
          customTitle: custom ? "Condição personalizada" : "",
          ctaLabel: custom ? cta.custom : cta.wholesale,
          enabled: true,
        };
      }),
      priceOnRequest: "Sob consulta",
      priceOnRequestHint: "Valor por unidade informado no atendimento.",
    },
    subscription: {
      enabled: true,
      eyebrow: "Plataforma DirectPlaca",
      title: "Placas de um lado. Plataforma do outro.",
      text: "Além do estoque físico, o revendedor utiliza a plataforma DirectPlaca por meio de uma assinatura mensal, separada da compra das placas.",
      coversTitle: "A mensalidade cobre:",
      covers: ["Infraestrutura", "Sistema e atualizações", "Gerenciamento das placas", "DirectLab", "DirectLink", "Ferramentas digitais"],
      transparency: "O valor da mensalidade é apresentado antes da compra, junto com o valor das placas.",
      planName: "Plataforma DirectPlaca",
      monthlyPriceCents: platform.monthlyPriceCents,
      periodLabel: "/mês",
      priceNullTitle: "Mensalidade",
      priceNullText: "Valor informado antes da compra.",
      firstPeriod: { enabled: platform.firstPeriodIncluded.enabled, amount: 30, unit: "dias", text: platform.firstPeriodIncluded.text },
      features: [...platform.features],
      ctaLabel: cta.primary,
    },
    why: {
      enabled: true,
      eyebrow: "Por que revender DirectPlaca",
      title: "Um negócio seu, com tecnologia pronta.",
      text: "",
      items: [
        { id: "sem-comissao", icon: "revenue", title: "Sem comissão sobre suas vendas", text: "A DirectPlaca não cobra comissão sobre o que você vende.", enabled: true },
        { id: "seu-preco", icon: "tag", title: "Você define o seu preço", text: "Preço e estratégia de revenda são decisões suas.", enabled: true },
        { id: "fisico-software", icon: "plate", title: "Produto físico + software", text: "Você oferece a placa e a tecnologia que faz ela funcionar.", enabled: true },
        { id: "gestao", icon: "dashboard", title: "Gestão centralizada", text: "Placas, clientes e destinos em um único painel.", enabled: true },
        { id: "ferramentas", icon: "lab", title: "Ferramentas de valor agregado", text: "DirectLab com Avaliação Google e DirectLink.", enabled: true },
        { id: "atacado", icon: "box", title: "Compra no atacado", text: "Lotes por quantidade, para você montar o seu estoque.", enabled: true },
      ],
    },
    about: {
      enabled: true,
      eyebrow: "Sobre a DirectPlaca",
      title: "Produto físico e tecnologia, em uma experiência simples.",
      text: "A DirectPlaca nasceu para unir produtos físicos e tecnologia. Criamos uma plataforma para gerenciar placas inteligentes com QR Code e NFC, entregando ao revendedor uma solução pronta para comercializar e administrar os seus próprios clientes.",
      image: null,
    },
    faq: {
      enabled: true,
      eyebrow: "Dúvidas frequentes",
      title: "Perguntas importantes antes de começar.",
      text: "",
      items: faqPairs.map(([q, a], i) => ({ id: `faq-${i + 1}`, q, a, enabled: true })),
    },
    finalCta: {
      enabled: true,
      eyebrow: "",
      title: "Quer começar a revender DirectPlaca?",
      text: "Escolha o seu lote e fale com a nossa equipe.",
      primaryCta: contactCta(cta.final),
      secondaryCta: null,
    },
    contact: {
      whatsappNumber: digits.length >= 10 ? digits : "",
      whatsappMessage: contact.whatsappMessage,
      email: contact.email ?? "",
      formUrl: contact.formUrl ?? "",
      preferred: "auto",
    },
    footer: {
      text: "Placas inteligentes com QR Code e NFC.",
      copyright: "© {ano} DirectPlaca.",
      links: [{ id: "area-revendedor", label: "Área do revendedor", url: "/login", enabled: true }],
      socials: [],
    },
    seo: {
      title: "DirectPlaca | Placas inteligentes para revendedores",
      description:
        "Compre placas inteligentes com QR Code e NFC no atacado, gerencie tudo na plataforma DirectPlaca e revenda por conta própria, com o seu preço e sem comissão sobre as suas vendas.",
      siteUrl: LANDING_CONFIG.siteUrl ?? "",
      ogTitle: "",
      ogDescription: "",
      ogImage: null,
      index: true,
    },
  };
}
