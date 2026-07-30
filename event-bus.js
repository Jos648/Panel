/**
 * Uygulama içi gevşek bağlı iletişim.
 * Paneller birbirini tanımaz; yalnızca olayları dinler.
 * ✅ Enhanced: handler hataları artık bağlamıyla loglanıyor ve 'error'
 *    olayı olarak da yayınlanıyor (üst seviye bir dinleyici isterse yakalayabilir).
 */
const handlers = new Map();

export const bus = {
  on(event, fn) {
    if (!handlers.has(event)) handlers.set(event, []);
    handlers.get(event).push(fn);
    return () => {
      const list = handlers.get(event) ?? [];
      handlers.set(event, list.filter(f => f !== fn));
    };
  },

  emit(event, payload) {
    for (const fn of handlers.get(event) ?? []) {
      try {
        fn(payload);
      } catch (e) {
        // ✅ Enhanced: bağlamlı log + hatayı yutmadan ayrıca yayınla
        console.error(`[bus:${event}] Handler failed:`, e.message);
        if (event !== 'error') bus.emit('error', { event, error: e });
      }
    }
  },
};
