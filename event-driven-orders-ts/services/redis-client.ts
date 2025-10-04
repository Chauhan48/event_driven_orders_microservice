import { createClient } from 'redis';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

const redisClient = createClient({
    url: 'redis://localhost:6379'
});

redisClient.on('error', (err) => logger.error('Redis Client Error', err));

(async () => {
    await redisClient.connect();
    logger.info('Redis client connected');
})();

export default redisClient;