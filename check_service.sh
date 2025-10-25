#!/bin/bash
# Script para verificar el servicio de red de WSL

echo "🔍 Verificando servicio de red de WSL..."
echo ""

echo "📊 Estado del servicio:"
sudo systemctl status wsl-network-fix.service --no-pager

echo ""
echo "🌐 Verificando conectividad:"
if curl -s --connect-timeout 5 https://google.com > /dev/null; then
    echo "✅ Internet funcionando correctamente"
else
    echo "❌ Sin internet - ejecutando arreglo..."
    ./fix_network.sh
fi

echo ""
echo "🔧 Comandos útiles:"
echo "  - Ver logs: sudo journalctl -u wsl-network-fix.service"
echo "  - Reiniciar servicio: sudo systemctl restart wsl-network-fix.service"
echo "  - Deshabilitar: sudo systemctl disable wsl-network-fix.service"
