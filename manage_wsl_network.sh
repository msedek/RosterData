#!/bin/bash
# Gestor completo del servicio de red de WSL

case "$1" in
    "install")
        echo "🔧 Instalando servicio de red automático..."
        sudo systemctl daemon-reload
        sudo systemctl enable wsl-network-fix.service
        sudo systemctl start wsl-network-fix.service
        echo "✅ Servicio instalado y activado"
        ;;
    "status")
        echo "📊 Estado del servicio:"
        sudo systemctl status wsl-network-fix.service --no-pager
        echo ""
        echo "🌐 Conectividad:"
        if curl -s --connect-timeout 3 https://google.com > /dev/null; then
            echo "✅ Internet funcionando"
        else
            echo "❌ Sin internet"
        fi
        ;;
    "fix")
        echo "🔧 Arreglando conectividad manualmente..."
        ./fix_network.sh
        ;;
    "restart")
        echo "🔄 Reiniciando servicio..."
        sudo systemctl restart wsl-network-fix.service
        echo "✅ Servicio reiniciado"
        ;;
    "disable")
        echo "⛔ Deshabilitando servicio..."
        sudo systemctl disable wsl-network-fix.service
        sudo systemctl stop wsl-network-fix.service
        echo "✅ Servicio deshabilitado"
        ;;
    "logs")
        echo "📋 Logs del servicio:"
        sudo journalctl -u wsl-network-fix.service --no-pager -n 20
        ;;
    *)
        echo "🔧 Gestor de red WSL"
        echo ""
        echo "Uso: $0 {install|status|fix|restart|disable|logs}"
        echo ""
        echo "Comandos:"
        echo "  install  - Instalar y activar el servicio automático"
        echo "  status   - Ver estado del servicio y conectividad"
        echo "  fix      - Arreglar conectividad manualmente"
        echo "  restart  - Reiniciar el servicio"
        echo "  disable  - Deshabilitar el servicio"
        echo "  logs     - Ver logs del servicio"
        ;;
esac
