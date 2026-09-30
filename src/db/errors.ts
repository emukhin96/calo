// Ошибки слоя данных — маршруты API превращают их в 404 и 400.

/** Нет такой записи у владельца (или она чужая). */
export class NotFoundError extends Error {}

/** Запрос противоречит данным: например, приём другого дня. */
export class BadRequestError extends Error {}
