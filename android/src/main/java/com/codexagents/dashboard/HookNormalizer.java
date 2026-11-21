package com.codexagents.dashboard;

import android.content.res.AssetManager;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Function;
import org.mozilla.javascript.Scriptable;

final class HookNormalizer {
  private final Scriptable scope;
  private final Function normalize;

  HookNormalizer(AssetManager assets) throws IOException {
    try (InputStream script = assets.open("normalize.js"); Context context = Context.enter()) {
      context.setLanguageVersion(Context.VERSION_ES6);
      context.setInterpretedMode(true);
      context.setClassShutter(name -> false);
      scope = context.initSafeStandardObjects();
      ByteArrayOutputStream code = new ByteArrayOutputStream();
      byte[] buffer = new byte[4096];
      for (int count; (count = script.read(buffer)) != -1;) code.write(buffer, 0, count);
      context.evaluateString(scope, new String(code.toByteArray(), StandardCharsets.UTF_8), "normalize.js", 1, null);
      Scriptable hooks = (Scriptable) scope.get("DashboardHooks", scope);
      normalize = (Function) hooks.get("normalize", hooks);
    }
  }

  synchronized Result normalize(String body, String machine, String harness) {
    try (Context context = Context.enter()) {
      context.setLanguageVersion(Context.VERSION_ES6);
      context.setInterpretedMode(true);
      context.setClassShutter(name -> false);
      Object[] args = {body, machine, harness, UUID.randomUUID().toString()};
      Scriptable result = (Scriptable) normalize.call(context, scope, scope, args);
      return new Result((int) Context.toNumber(result.get(0, result)), Context.toString(result.get(1, result)));
    } catch (RuntimeException | StackOverflowError error) {
      return new Result(400, "{\"error\":\"Invalid event.\"}");
    }
  }

  static final class Result {
    final int status;
    final String json;

    Result(int status, String json) {
      this.status = status;
      this.json = json;
    }
  }
}
