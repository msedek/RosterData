#!/bin/bash
# Script automático para arreglar conectividad de WSL
# Se ejecuta automáticamente al iniciar WSL

# Verificar si hay internet
if ! curl -s --connect-timeout 3 https://google.com > /dev/null 2>&1; then
    echo "🔧 WSL sin internet - arreglando automáticamente..."
    
    # Configurar DNS
    sudo tee /etc/resolv.conf > /dev/null << 'EOF'
nameserver 8.8.8.8
nameserver 1.1.1.1
EOF
    
    # Activar interfaz de red
    sudo ip link set eth0 up
    
    # Verificar si funcionó
    if curl -s --connect-timeout 5 https://google.com > /dev/null 2>&1; then
        echo "✅ Internet restaurado automáticamente"
    else
        echo "❌ Reinicia WSL con: wsl --shutdown"
    fi
fi
