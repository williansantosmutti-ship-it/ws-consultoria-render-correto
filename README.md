# WS Consultoria - Sistema de Gestao

Sistema web local para controlar condominios, visitas, cupons, vendedores, planos, agenda, acessos e relatorios.

## O que ja esta incluido

- Dashboard com filtros: resumo, vendas, visitas, EXPANSAO e vistoria.
- Aba EXPANSAO para protocolos de implantacao, ampliacao e vistoria, com protocolo IXC, endereco, obs e status.
- Agenda em calendario mensal com observacoes no dia e horario.
- Lembretes na tela e notificacoes do navegador enquanto o sistema estiver aberto.
- Vendas com importacao por link CSV publicado de planilha online.
- Planos organizados por cidade, tipo de servico, tabela/anexo e detalhes.
- Relatorios com graficos, resumos e separacao por atividade.
- Modo claro e modo escuro.
- Layout premium baseado na logo WS Consultoria.
- Dados importados das planilhas enviadas: 467 condominios e 105 planos.
- Instalacao como app no iPhone, Android e computador por PWA.
- Preparacao para publicacao segura com HTTPS, dominio e app instalavel.

## Como rodar

1. Instale o Node.js LTS em https://nodejs.org
2. Abra esta pasta no terminal.
3. Rode uma das opcoes:

```bash
npm start
```

ou:

```bash
node server.js
```

4. Acesse no navegador:

```text
http://localhost:3000
```

## Como usar como app no celular

Depois que o sistema estiver hospedado ou aberto pelo endereco correto:

### iPhone

1. Abra o sistema no Safari.
2. Toque no botao de compartilhar.
3. Toque em `Adicionar a Tela de Inicio`.
4. Confirme o nome `WS CONSULTORIA`.

### Android

1. Abra o sistema no Chrome.
2. Toque nos tres pontos.
3. Toque em `Instalar app` ou `Adicionar a tela inicial`.
4. Confirme.

### Computador

1. Abra o sistema no Chrome ou Edge.
2. Clique no icone de instalar na barra de endereco, quando aparecer.
3. Confirme a instalacao.

## Acesso de outros aparelhos

Para usar em qualquer computador ou celular sem instalar nada, o sistema precisa estar hospedado na internet com um link fixo, por exemplo:

```text
https://wsconsultoria.com.br
```

Rodando apenas neste computador, ele fica local. Nesse caso, outros aparelhos so acessam se estiverem na mesma rede Wi-Fi e usando o IP deste computador.

Para publicar de forma profissional e segura, veja:

```text
GUIA-ONLINE-SEGURO.md
```

## Login inicial

- Email: `williansantos.mutti@gmail.com`
- Senha: a senha informada para o administrador inicial.

Por seguranca, altere a senha depois do primeiro acesso em `Acessos`.

## Observacoes importantes

- Os dados ficam em `data/store.json`.
- Para usar envio real de email automatico e sincronizacao direta com Google Agenda, sera necessario configurar servicos externos: SMTP/Email API e Google Calendar API.
- Enquanto essas integracoes nao forem configuradas, o sistema cria links de email e links de agenda do Google para confirmar e registrar compromissos rapidamente.
- Para importar vendas de uma planilha online, publique a planilha como CSV e cole o link na aba `Vendas`. Cabecalhos aceitos: vendedor, cliente, plano, valor, data, condominio, status e obs.
