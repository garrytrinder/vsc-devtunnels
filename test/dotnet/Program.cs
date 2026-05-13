var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/", () =>
{
    var tunnelUrl = app.Configuration["DevTunnelUrl"] ?? "not set";

    return Results.Content(
        "<html>" +
        "<head><title>Dev Tunnels Test (.NET)</title>" +
        "<style>" +
        "body { font-family: system-ui, sans-serif; max-width: 600px; margin: 60px auto; color: #333; } " +
        "h1 { color: #0078d4; } " +
        "dt { font-weight: bold; margin-top: 12px; } " +
        "dd { margin: 4px 0 0 0; font-family: monospace; background: #f4f4f4; padding: 6px 10px; border-radius: 4px; }" +
        "</style></head>" +
        "<body>" +
        "<h1>Dev Tunnels Test App (.NET)</h1>" +
        "<p>Running on port 5000</p>" +
        "<dl>" +
        $"<dt>Tunnel URL</dt><dd>{tunnelUrl}</dd>" +
        "</dl>" +
        "</body></html>",
        "text/html");
});

app.Run("http://localhost:5000");
