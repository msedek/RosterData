#!/bin/bash

# Script para refrescar el caché de todos los personajes prioritarios
# Ejecuta cada comando secuencialmente y espera el resultado antes de continuar

echo "=== Iniciando refresh de caché - $(date) ==="

# 1. Jesseigh
echo "Refrescando Jesseigh..."
curl -s -X POST http://localhost:3000/cache/refresh/Jesseigh
echo ""

# 2. Mselancer
echo "Refrescando Mselancer..."
curl -s -X POST http://localhost:3000/cache/refresh/Mselancer
echo ""

# 3. Kadub
echo "Refrescando Kadub..."
curl -s -X POST http://localhost:3000/cache/refresh/Kadub
echo ""

# 4. Rathofdemise
echo "Refrescando Rathofdemise..."
curl -s -X POST http://localhost:3000/cache/refresh/Rathofdemise
echo ""

# 5. Temran
echo "Refrescando Temran..."
curl -s -X POST http://localhost:3000/cache/refresh/Temran
echo ""

# 6. Aelvjin
echo "Refrescando Aelvjin..."
curl -s -X POST http://localhost:3000/cache/refresh/Aelvjin
echo ""

# 7. Saleco
echo "Refrescando Saleco..."
curl -s -X POST http://localhost:3000/cache/refresh/Saleco
echo ""

echo "=== Refresh de caché completado - $(date) ==="
