# 🍿 Glass Cinema

![Glass Cinema](assets/icon.png)

**Glass Cinema** is a modern, beautiful desktop application for streaming movies directly from torrents without waiting for downloads. It features a sleek glass-morphism UI, automatic subtitle handling, and seamless Chromecast integration.

---

## ✨ Features

- **🚀 Instant Streaming**: Play movies instantly using Magnet links or by searching the built-in YTS integration.
- **📺 Chromecast Support**: Cast your movies directly to your TV with subtitle support.
- **📝 Smart Subtitles**: Automatically fetches and loads subtitles in your preferred language.
- **🎨 Glass UI**: A premium, translucent interface designed for maximum immersion.
- **💾 Library Management**: Save your favorites and keep track of your watchlist locally.
- **⚡ Lightweight & Fast**: Built with Electron and optimized for performance.

---

## 🛠️ Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/yourusername/glass-cinema-project.git
    cd glass-cinema-project
    ```

2.  **Install dependencies**
    ```bash
    npm install
    # or
    pnpm install
    ```

3.  **Setup Environment**
    Critial: Create a `.env` file in the root directory.
    ```env
    NODE_ENV=production
    STREAM_PORT=62182
    MOVIE_API_URL=https://api.example.com/movies
    SUBTITLES_API_URL=https://api.example.com/subtitles
    TMDB_API_KEY=your_tmdb_api_key_here
    ```

4.  **Run the App**
    ```bash
    npm start
    ```

## 📦 Build Installer

To create a Windows executable (`.exe`):

```bash
npm run dist
```

The installer will be located in the `dist/` folder.

---
---

# 🇪🇸 Español

**Glass Cinema** es una aplicación de escritorio moderna y elegante para ver películas directamente desde torrents sin esperar descargas. Cuenta con una interfaz estilo "glass-morphism", manejo automático de subtítulos e integración fluida con Chromecast.

## ✨ Características Principales

- **🚀 Streaming Instantáneo**: Reproduce películas al instante usando enlaces Magnet o el buscador integrado de YTS.
- **📺 Soporte Chromecast**: Envía tus películas directamente a tu TV con subtítulos incluidos.
- **📝 Subtítulos Inteligentes**: Busca y carga automáticamente subtítulos en tu idioma.
- **🎨 Interfaz de Vidrio**: Un diseño premium y translúcido pensado para la inmersión.
- **💾 Tu Biblioteca**: Guarda tus favoritos y lista de pendientes localmente.
- **⚡ Ligero y Rápido**: Construido con Electron y optimizado para el rendimiento.

## 🛠️ Instalación

1.  **Clonar el repositorio**
    ```bash
    git clone https://github.com/tuusuario/glass-cinema-project.git
    cd glass-cinema-project
    ```

2.  **Instalar dependencias**
    ```bash
    npm install
    # o
    pnpm install
    ```

3.  **Configurar Entorno**
    Importante: Crea un archivo `.env` en la raíz.
    ```env
    NODE_ENV=production
    STREAM_PORT=62182
    MOVIE_API_URL=https://api.example.com/movies
    SUBTITLES_API_URL=https://api.example.com/subtitles
    TMDB_API_KEY=tu_api_key_de_tmdb_aqui
    ```

4.  **Iniciar la App**
    ```bash
    npm start
    ```

## 📦 Crear Instalador

Para crear el ejecutable de Windows (`.exe`):

```bash
npm run dist
```

El instalador aparecerá en la carpeta `dist/`.
