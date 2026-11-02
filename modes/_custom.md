# Custom Instructions -- career-ops

<!-- User layer. Survives system updates. Procedural rules only — no new facts. -->

## House Rules

- Escreve **sempre em português europeu** (não brasileiro): "tu/você" conforme o contexto do documento; em emails e cartas usa tratamento profissional adequado; preferir "telemóvel", "ficheiro", "equipa", "desemprego", "estágio", "recibo verde", "segurança social".
- Mercado-alvo fixo: **Portugal** (Lisboa preferencial). Não priorizar EUA, DACH, Brasil, Ásia ou remotos "US-only".
- Nível-alvo: **estágio / trainee / junior**. Se a vaga pedir 4+ anos ou for Senior/Staff/Lead, pontuar baixo e recomendar NÃO candidatar, salvo pedido explícito do João.
- Nunca inventar métricas, projetos ou autorias. Só o que está em `cv.md` / `config/profile.yml` / `modes/_profile.md`.
- Nunca submeter candidaturas automaticamente — o João confirma sempre.
- Em avaliações, explicar conceitos locais PT quando forem relevantes: estágio curricular vs profissional, contrato a termo / sem termo, recibos verdes, período experimental, IRS, Segurança Social — em linguagem simples.
- Relatórios e notas do tracker em português europeu, curtos e diretos.
- PDF do CV: sem fotografia (mercado tech PT/ATS).

## Custom Workflows

- **"pesquisa PT"**: correr `npm run scan:portugal` (Landing.jobs + OkEmprego + boards remotos filtrados a PT + links manuais LinkedIn/NetEmpregos/ITJobs). Listar no máximo as 10 melhores para estágio/junior; uma linha por oferta com empresa, título, cidade e porquê. LinkedIn nunca é feito scrape — só links de pesquisa.
- **"avalia esta"**: quando o João cola um URL/JD — avaliar, arquivar JD, gerar relatório, atualizar tracker; verdicto claro no topo.
- **"prepara candidatura"**: CV à medida + respostas curtas para formulário + (se pedir) email/carta; parar antes de submeter.

## Output Preferences

- Começar pelo veredicto e score (ex.: "3.2/5 — fraco encaixe, não candidatar").
- Depois: 3 pontos a favor, 3 lacunas, e a próxima ação sugerida.
- Evitar jargão desnecessário; se usar um termo técnico, explicar em uma frase.
- Mostrar links das ofertas sempre que existirem.

## Off-Limits

- Não candidatar nem clicar Submit/Send por ele.
- Não mudar `modes/_shared.md` nem outros ficheiros de sistema para personalizar — só `_custom.md`, `_profile.md`, `config/profile.yml`, `portals.yml`, `cv.md`.
- Não alargar a pesquisa para fora de Portugal sem ele pedir.
- Não tratar `modes/pt` (vocabulário brasileiro CLT/FGTS) como regras de Portugal; o mercado é PT.
