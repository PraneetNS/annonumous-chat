module.exports = {
    apps: [{
        name: 'e2ee-chat-server',
        script: './dist/server/index.js',

        // Cluster mode for load balancing across CPU cores
        instances: 'max',
        exec_mode: 'cluster',

        // Environment variables
        env: {
            NODE_ENV: 'production'
        },

        // Auto-restart on memory limit
        max_memory_restart: '512M',

        // Logging
        error_file: './logs/err.log',
        out_file: './logs/out.log',
        log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
        merge_logs: true,

        // Graceful shutdown
        kill_timeout: 30000,
        wait_ready: true,
        listen_timeout: 10000,

        // Auto-restart configuration
        autorestart: true,
        max_restarts: 10,
        min_uptime: '10s',

        // Watch mode (disable in production)
        watch: false,

        // Ignore watch
        ignore_watch: ['node_modules', 'logs', '.git'],

        // Environment-specific configuration
        env_production: {
            NODE_ENV: 'production',
            LOG_LEVEL: 'info'
        },
        env_staging: {
            NODE_ENV: 'production',
            LOG_LEVEL: 'debug'
        },
        env_development: {
            NODE_ENV: 'development',
            LOG_LEVEL: 'debug'
        }
    }]
};
