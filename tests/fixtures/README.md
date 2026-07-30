# Test fixtures

`graph-test-key.pem` is a **throwaway** RSA keypair and self-signed certificate,
generated solely so `email.graph.test.ts` can sign a real client assertion and
verify the signature against the real public key.

It authenticates nothing. It was never uploaded to Entra, and the production
certificate lives on the Mac at `~/.config/cocktails/graph-key.pem` — mode 600,
never in this repository. Only that certificate's _public_ half is ever shared.
