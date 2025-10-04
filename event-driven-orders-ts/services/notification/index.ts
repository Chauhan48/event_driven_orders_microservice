import redisClient from '../redis-client';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] [NOTIFICATION-SERVICE] ${level.toUpperCase()}: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        }),
        new winston.transports.File({ filename: 'logs/notification-service.log' })
    ]
});

(async function consumePayments() {
    let lastId = '0-0';
    logger.info('Notification Service started - listening for payment events');

    while (true) {
        try {
            const messages = await redisClient.xRead(
                [{ key: 'payments', id: lastId }],
                { BLOCK: 0, COUNT: 10 }
            );

            if (!messages || !Array.isArray(messages)) continue;

            for (const stream of messages) {
                if (!stream || typeof stream !== 'object' || !('messages' in stream)) continue;
                if (!Array.isArray(stream.messages)) continue;

                for (const message of stream.messages) {
                    if (!message || typeof message !== 'object') continue;
                    if (!('id' in message) || typeof message.id !== 'string') continue;
                    if (!('message' in message) || typeof message.message !== 'object') continue;

                    lastId = message.id;
                    const { type, orderId } = message.message as any;

                    if (type === 'PaymentCompleted') {
                        logger.info(`📧 NOTIFICATION: Payment successful for order ${orderId}`);
                        logger.info(`   → Sending confirmation email to customer`);
                        
                        await redisClient.xAdd('order_updates', '*', {
                            orderId,
                            status: 'COMPLETED'
                        });
                    } else if (type === 'PaymentFailed') {
                        logger.warn(`📧 NOTIFICATION: Payment failed for order ${orderId}`);
                        logger.warn(`   → Sending failure notification to customer`);
                        
                        await redisClient.xAdd('order_updates', '*', {
                            orderId,
                            status: 'FAILED'
                        });
                    }
                }
            }
        } catch (error) {
            logger.error(`Error sending notifications: ${error}`);
        }
    }
})();