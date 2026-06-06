# WS CONSULTORIA - PUBLICACAO ONLINE SEGURA

Este sistema ja esta preparado para rodar como app no celular e no computador. Para acessar de qualquer lugar, ele precisa ficar em um servidor com HTTPS.

## Opcao recomendada

Use um servidor VPS simples com:

- Ubuntu LTS
- Node.js LTS
- Nginx
- Certificado SSL gratuito pelo Let's Encrypt
- Dominio ou subdominio, por exemplo `sistema.wsconsultoria.com.br`

## Passo a passo geral

1. Contrate uma VPS.
2. Aponte o dominio ou subdominio para o IP da VPS.
3. Instale Node.js LTS no servidor.
4. Envie esta pasta do sistema para o servidor.
5. Copie `.env.example` para `.env`.
6. Ajuste `NODE_ENV=production`.
7. Rode o sistema com um gerenciador como PM2.
8. Configure o Nginx como proxy reverso.
9. Ative HTTPS com Let's Encrypt.
10. Acesse pelo link final no iPhone, Android ou computador.

## Exemplo de Nginx

```nginx
server {
    server_name sistema.wsconsultoria.com.br;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

## Cuidados obrigatorios

- Troque a senha inicial antes de publicar.
- Crie usuarios separados para cada pessoa.
- Use HTTPS sempre.
- Faca backup frequente do arquivo `data/store.json`.
- Nao coloque a pasta `data` dentro de hospedagem estatica.
- Nao envie `.env` para terceiros.

## Backup

O banco principal fica em:

```text
data/store.json
```

Copie esse arquivo periodicamente para um local seguro.

