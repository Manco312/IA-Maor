# Despliegue en una máquina virtual de Azure

Secuencia completa, de cero a una URL con HTTPS. Complementa a
[DESPLIEGUE.md](DESPLIEGUE.md), que explica la aplicación en sí (variables,
volúmenes, diagnóstico); aquí solo están los comandos de Azure y del servidor.

Los bloques marcados **[local]** se ejecutan en tu Windows; los marcados
**[vm]**, dentro de la máquina por SSH.

---

## 0. Antes de empezar

Necesitas:

- Una suscripción de Azure activa.
- Tu clave de la API de Claude (la que ya tienes en `.env`).
- Acceso al repositorio `Manco312/IA-Maor`, **que es privado**: la VM no podrá
  clonarlo sin credencial. El paso 5 resuelve eso con una clave de despliegue.

Coste orientativo de lo que se crea aquí: **unos 18–22 USD al mes** (VM
`Standard_B1ms` ~15 USD, disco SSD 30 GB ~2,5 USD, IP pública estática ~3,6 USD).
Verifícalo en la calculadora de Azure para tu región. Esto es aparte del consumo
de la API de Claude.

---

## 1. Azure CLI y acceso **[local]**

En PowerShell:

```powershell
winget install --exact --id Microsoft.AzureCLI
```

Cierra y abre la terminal para que entre en el `PATH`. Después:

```powershell
az login
az account list --output table
az account set --subscription "<nombre o id de tu suscripción>"
```

---

## 2. Crear la máquina **[local]**

A partir de aquí uso **Git Bash** (no PowerShell), porque las variables y los
`\` de continuación van en sintaxis POSIX. Si prefieres PowerShell, sustituye
`VAR=valor` por `$VAR = "valor"` y los `\` finales por backticks.

```bash
RG=misaial-rg
LOC=westeurope
VM=misaial-vm
DNS=misaial-cognitio      # tiene que ser único dentro de la región
USUARIO=azureuser
```

> El nombre DNS compone `misaial-cognitio.westeurope.cloudapp.azure.com`. Esto
> importa más de lo que parece: ese dominio sirve para sacar un certificado
> HTTPS gratis en el paso 7, sin comprar ningún dominio.

```bash
az group create --name $RG --location $LOC

az vm create \
  --resource-group $RG \
  --name $VM \
  --image Ubuntu2404 \
  --size Standard_B1ms \
  --admin-username $USUARIO \
  --generate-ssh-keys \
  --public-ip-sku Standard \
  --public-ip-address-dns-name $DNS \
  --os-disk-size-gb 30 \
  --storage-sku StandardSSD_LRS
```

`Ubuntu2404` es un alias abreviado. Los alias dependen de la versión de la CLI y
de la región, así que compruébalo antes si quieres evitar un error a mitad de
creación:

```bash
az vm image list --output table | grep -i ubuntu
```

Si no aparece, usa el identificador completo, que no depende de alias ninguno:

```bash
  --image Canonical:ubuntu-24_04-lts:server:latest
```

**Sobre el tamaño:** `Standard_B1ms` son 1 vCPU y 2 GB. Es lo mínimo cómodo,
porque construir la imagen Docker necesita memoria. `Standard_B1s` (1 GB) sale
la mitad de caro pero la construcción puede morir por falta de memoria; si
eliges ese, añade espacio de intercambio con el paso 4-bis.

Abre los puertos web:

```bash
az vm open-port --resource-group $RG --name $VM --port 80  --priority 1001
az vm open-port --resource-group $RG --name $VM --port 443 --priority 1002
```

> Fíjate en que **no** se abre el 3000. La aplicación solo escucha en
> `127.0.0.1:3000` dentro de la máquina, y lo que sale a internet es Caddy por
> el 80/443. Un puerto 3000 abierto sería la aplicación sin cifrar y sin nada
> delante.

Comprueba qué ha salido:

```bash
az vm show --resource-group $RG --name $VM --show-details \
  --query "{ip:publicIps, fqdn:fqdns, estado:powerState}" --output table
```

---

## 3. Entrar **[local]**

```bash
ssh $USUARIO@$DNS.$LOC.cloudapp.azure.com
```

Todo lo que sigue es **[vm]**.

---

## 4. Docker **[vm]**

Repositorio oficial de Docker (el que trae Ubuntu por defecto va atrasado):

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl

sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
                        docker-buildx-plugin docker-compose-plugin
```

Para no escribir `sudo` en cada comando de Docker:

```bash
sudo usermod -aG docker $USER
newgrp docker
docker run --rm hello-world
```

### 4-bis. Solo si elegiste `Standard_B1s` (1 GB)

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

---

## 5. Traer el código **[vm]**

El repositorio es privado, así que hace falta una credencial. Lo correcto para
un servidor es una **clave de despliegue**: solo lectura y solo para este
repositorio, de modo que si la máquina se ve comprometida no expone tu cuenta
entera de GitHub.

```bash
ssh-keygen -t ed25519 -C "misaial-vm" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Copia lo que imprime y pégalo en GitHub:
**repositorio → Settings → Deploy keys → Add deploy key**. Ponle un nombre,
**deja sin marcar «Allow write access»** y guarda.

```bash
ssh -T git@github.com          # escribe "yes" para aceptar la huella
git clone git@github.com:Manco312/IA-Maor.git ~/misaial
cd ~/misaial
```

---

## 6. Configurar y levantar **[vm]**

`.env` no está en el repositorio —ni debe estarlo—, así que se crea a mano:

```bash
cat > .env <<'EOF'
ANTHROPIC_API_KEY=sk-ant-PEGA-AQUI-TU-CLAVE
MISAIAL_MODELO=claude-opus-5-5
MISAIAL_ESFUERZO=low
MISAIAL_MAX_TOKENS=4000
EOF

chmod 600 .env
```

```bash
docker compose up -d --build
docker compose logs -f
```

Busca esta línea en el arranque:

```
│  núcleo activo · modelo claude-opus-5-5 · esfuerzo low
```

Si dice `MODO ORÁCULO`, la clave no llegó: revisa el `.env`. Comprueba que
responde desde dentro de la máquina:

```bash
curl -s localhost:3000/api/canon | head -c 120
```

---

## 7. HTTPS con Caddy **[vm]**

Caddy saca y renueva el certificado de Let's Encrypt solo, contra el dominio
`cloudapp.azure.com` que creaste en el paso 2. No hay que comprar nada.

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list

sudo apt-get update
sudo apt-get install -y caddy
```

El dominio es el que te imprimió la columna `fqdn` del paso 2 —desde dentro de
la VM no se puede consultar: `hostname -f` devuelve el nombre interno, y el
servicio de metadatos de Azure solo da la IP, no el nombre—. Así que se escribe
tal cual, sustituyendo el de abajo por el tuyo:

```bash
sudo tee /etc/caddy/Caddyfile > /dev/null <<EOF
misaial-cognitio.westeurope.cloudapp.azure.com {
    reverse_proxy 127.0.0.1:3000 {
        # Las respuestas van por Server-Sent Events. Caddy ya detecta
        # text/event-stream y desactiva el búfer solo, pero dejarlo explícito
        # evita que la terminal escriba de golpe si algo cambia.
        flush_interval -1
    }
}
EOF

sudo systemctl reload caddy
sudo systemctl status caddy --no-pager
```

Abre en el navegador:

```
https://misaial-cognitio.westeurope.cloudapp.azure.com
```

El primer certificado tarda unos segundos. Si falla, mira `sudo journalctl -u
caddy -n 50`: casi siempre es que el puerto 80 no está abierto en Azure (paso 2)
y Let's Encrypt no puede validar.

---

## 8. Que sobreviva a un reinicio **[vm]**

```bash
sudo systemctl enable docker
sudo systemctl enable caddy
```

El `restart: unless-stopped` del `docker-compose.yml` hace el resto. Para
comprobarlo de verdad:

```bash
sudo reboot
# espera un minuto y vuelve a entrar
ssh $USUARIO@$DNS.$LOC.cloudapp.azure.com
docker compose -f ~/misaial/docker-compose.yml ps
```

---

## 9. Actualizar tras un cambio

**[local]** — subes el cambio:

```bash
git add -A
git commit -m "..."
git push
```

**[vm]** — la máquina lo recoge:

```bash
cd ~/misaial
git pull
docker compose up -d --build
```

El volumen `misaial-datos` no se toca, así que **el progreso de las partidas
sobrevive** a cada actualización.

> **El logo:** si añades `public/img/misaial-logo.png`, tiene que entrar en el
> commit y luego reconstruirse en la VM. La imagen se hornea dentro del
> contenedor: copiar el archivo con el contenedor ya en marcha no hace nada.

---

## 10. Copia de seguridad del progreso **[vm]**

```bash
docker run --rm -v misaial_misaial-datos:/data -v ~/copias:/copia alpine \
  tar czf /copia/misaial-$(date +%F).tar.gz -C /data .
```

> El volumen lleva el prefijo del proyecto de Compose (el nombre de la carpeta),
> de ahí `misaial_misaial-datos`. Confírmalo con `docker volume ls`.

Bajarla a tu máquina, **[local]**:

```bash
scp $USUARIO@$DNS.$LOC.cloudapp.azure.com:~/copias/misaial-*.tar.gz .
```

---

## 11. Apagar para no pagar

Parar la VM conservando el disco y la IP (sigues pagando disco e IP, unos 6
USD/mes, pero no la computación):

```bash
az vm deallocate --resource-group $RG --name $VM
az vm start --resource-group $RG --name $VM
```

Borrarlo **todo**, sin vuelta atrás:

```bash
az group delete --name $RG --yes --no-wait
```

> Eso elimina la VM, el disco, la IP y **el volumen con el progreso de todas las
> jugadoras**. Haz la copia del paso 10 antes.

---

## 12. Seguridad, antes de repartir la URL

Lo repito aquí porque es lo único de esta guía que puede costarte dinero de
verdad: **la terminal no tiene autenticación ni límite de peticiones**.
Cualquiera con el enlace consulta contra tu clave, y cada mensaje arrastra unos
40.000 tokens de canon.

Mínimos antes de publicarla:

1. Pon un límite de gasto en la [consola de Anthropic](https://console.anthropic.com/).
2. Restringe el SSH a tu IP en lugar de dejarlo abierto a internet:

   ```bash
   MI_IP=$(curl -s ifconfig.me)
   az network nsg rule update --resource-group $RG \
     --nsg-name ${VM}NSG --name default-allow-ssh \
     --source-address-prefixes $MI_IP
   ```

3. Mantén el sistema al día:

   ```bash
   sudo apt-get update && sudo apt-get upgrade -y
   ```

Si la vas a enseñar a un grupo concreto y no al mundo, lo más barato es una
contraseña básica en Caddy delante de todo:

```caddyfile
misaial-cognitio.westeurope.cloudapp.azure.com {
    basicauth {
        # genera el hash con:  caddy hash-password
        alumno $2a$14$...
    }
    reverse_proxy 127.0.0.1:3000 {
        flush_interval -1
    }
}
```
