#!/bin/bash
# Script para arreglar conectividad de WSL
# Ejecutar cada vez que WSL pierda internet

echo "Configurando DNS de WSL..."
sudo tee /etc/resolv.conf > /dev/null << 'EOF'
nameserver 8.8.8.8
nameserver 1.1.1.1
EOF

echo "Activando interfaz de red..."
sudo ip link set eth0 up

echo "Verificando conectividad..."
curl -s --connect-timeout 5 https://google.com > /dev/null && echo "✅ Internet funcionando" || echo "❌ Sin internet"

echo "Script completado. Si no hay internet, reinicia WSL con: wsl --shutdown"
